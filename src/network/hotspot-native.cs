using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Threading.Tasks;
using Windows.Foundation;
using Windows.Devices.WiFiDirect;
using Windows.Security.Credentials;

// Compiled locally against Windows metadata; no SDK, downloads or bundled binaries.
public sealed class LocalHotspot : IDisposable
{
    public sealed class Notice
    {
        public string type;
        public string status;
        public string error;
        public string address;
        public string peer;
    }
    private readonly ConcurrentQueue<Notice> notices = new ConcurrentQueue<Notice>();
    private readonly Dictionary<string, WiFiDirectDevice> devices = new Dictionary<string, WiFiDirectDevice>();
    private readonly object gate = new object();
    private WiFiDirectAdvertisementPublisher publisher;
    private WiFiDirectConnectionListener listener;
    private volatile bool disposed;
    private Task<string> stopInput;
    private HotspotIsolation isolation;
    public string[] ProtectedIds { get { return isolation == null ? new string[0] : isolation.InterfaceIds; } }
    public int FilterCount { get { return isolation == null ? 0 : isolation.FilterCount; } }
    public string Status { get { return publisher == null ? "Created" : publisher.Status.ToString(); } }
    public bool StopRequested { get { return stopInput != null && stopInput.IsCompleted; } }
    public void WatchInput() { stopInput = Task.Run(() => Console.ReadLine()); }

    private static NetworkInterface[] DirectInterfaces() {
        return NetworkInterface.GetAllNetworkInterfaces().Where(n =>
            n.Description.IndexOf("Wi-Fi Direct", StringComparison.OrdinalIgnoreCase) >= 0).ToArray();
    }
    public void VerifyIsolation() {
        lock (gate) {
            if (disposed || isolation == null) throw new InvalidOperationException("isolationFailed");
            isolation.Verify(DirectInterfaces().Select(n => n.Id).ToArray());
        }
    }
    public void Start(string ssid, string password, string executable, int dnsPort, int httpsPort, int httpPort)
    {
        var candidates = DirectInterfaces();
        // Reserve inactive Wi-Fi Direct candidates before advertising. Never touch an existing AP.
        if (candidates.Any(n => n.OperationalStatus == OperationalStatus.Up))
            throw new InvalidOperationException("sharingActive");
        isolation = new HotspotIsolation(candidates.Select(n => n.Id).ToArray(), executable, dnsPort, httpsPort, httpPort);
        VerifyIsolation();
        publisher = new WiFiDirectAdvertisementPublisher();
        publisher.StatusChanged += (sender, args) => notices.Enqueue(new Notice {
            type = "publisher", status = args.Status.ToString(), error = args.Error.ToString() });
        listener = new WiFiDirectConnectionListener();
        listener.ConnectionRequested += Connect;
        publisher.Advertisement.IsAutonomousGroupOwnerEnabled = true;
        publisher.Advertisement.LegacySettings.IsEnabled = true;
        publisher.Advertisement.LegacySettings.Ssid = ssid;
        publisher.Advertisement.LegacySettings.Passphrase = new PasswordCredential { Password = password };
        publisher.Start();
    }

    private async void Connect(WiFiDirectConnectionListener sender, WiFiDirectConnectionRequestedEventArgs args)
    {
        WiFiDirectDevice device = null;
        try
        {
            try { VerifyIsolation(); }
            catch { notices.Enqueue(new Notice { type = "isolationError" }); return; }
            using (var request = args.GetConnectionRequest())
            {
                var operation = WiFiDirectDevice.FromIdAsync(request.DeviceInformation.Id);
                var info = (IAsyncInfo)operation;
                var deadline = DateTime.UtcNow.AddSeconds(15);
                while (info.Status == AsyncStatus.Started)
                {
                    if (disposed || DateTime.UtcNow > deadline) { info.Cancel(); throw new TimeoutException(); }
                    await Task.Delay(100);
                }
                device = operation.GetResults();
                info.Close();
            }
            if (device == null) throw new InvalidOperationException();
            lock (gate)
            {
                if (disposed || devices.Count >= 8) { device.Dispose(); return; }
                WiFiDirectDevice previous;
                if (devices.TryGetValue(device.DeviceId, out previous)) {
                    previous.ConnectionStatusChanged -= Disconnected; previous.Dispose();
                }
                devices[device.DeviceId] = device;
                device.ConnectionStatusChanged += Disconnected;
            }
            var pair = device.GetConnectionEndpointPairs().FirstOrDefault(p =>
                p.LocalHostName.Type == Windows.Networking.HostNameType.Ipv4);
            if (pair != null) notices.Enqueue(new Notice { type = "peer",
                address = pair.LocalHostName.CanonicalName, peer = pair.RemoteHostName.CanonicalName });
        }
        catch
        {
            if (device != null) { lock (gate) { devices.Remove(device.DeviceId); device.Dispose(); } }
            notices.Enqueue(new Notice { type = "peerError" });
        }
    }

    private void Disconnected(WiFiDirectDevice sender, object args)
    {
        try {
            if (sender.ConnectionStatus != WiFiDirectConnectionStatus.Disconnected) return;
            lock (gate) {
                WiFiDirectDevice current;
                if (devices.TryGetValue(sender.DeviceId, out current) && Object.ReferenceEquals(current, sender)) devices.Remove(sender.DeviceId);
                sender.ConnectionStatusChanged -= Disconnected; sender.Dispose();
            }
            notices.Enqueue(new Notice { type = "disconnected" });
        } catch { notices.Enqueue(new Notice { type = "peerError" }); }
    }

    public Notice Next() { Notice notice; return notices.TryDequeue(out notice) ? notice : null; }

    public string[] Addresses()
    {
        // Never select a physical WLAN address or assume Windows uses a fixed subnet.
        return DirectInterfaces()
            .Where(n => n.OperationalStatus == OperationalStatus.Up)
            .SelectMany(n => n.GetIPProperties().UnicastAddresses)
            .Where(a => a.Address.AddressFamily == AddressFamily.InterNetwork &&
                !a.Address.ToString().StartsWith("169.254."))
            .Select(a => a.Address.ToString()).Distinct().ToArray();
    }

    public void Dispose()
    {
        lock (gate)
        {
            disposed = true;
            if (listener != null) listener.ConnectionRequested -= Connect;
            if (publisher != null) publisher.Stop();
            foreach (var device in devices.Values) { device.ConnectionStatusChanged -= Disconnected; device.Dispose(); }
            devices.Clear();
            // Publisher and peers are stopped BEFORE dynamic filtering policy is released.
            if (isolation != null) { isolation.Dispose(); isolation = null; }
        }
    }
}
