using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

// User-mode WFP management only; no driver or persistent system policy.
// GUIDs and layouts: Microsoft WinSDK fwpmu.h, fwpmtypes.h and fwptypes.h.
public sealed class HotspotIsolation : IDisposable
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Display { public string name; public string description; }
    [StructLayout(LayoutKind.Sequential)]
    private struct Session {
        public Guid key; public Display display; public uint flags, timeout, processId;
        public IntPtr sid, username; public int kernelMode;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct Blob { public uint size; public IntPtr data; }
    // Union has pointer alignment on both x86 and x64, unlike an explicit offset of 4.
    [StructLayout(LayoutKind.Explicit)]
    private struct Union {
        [FieldOffset(0)] public uint number;
        [FieldOffset(0)] public IntPtr pointer;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct Value { public uint type; public Union data; }
    [StructLayout(LayoutKind.Sequential)]
    private struct Condition { public Guid key; public uint match; public Value value; }
    [StructLayout(LayoutKind.Sequential)]
    private struct Action { public uint type; public Guid key; }
    [StructLayout(LayoutKind.Explicit, Size = 16)]
    private struct Context { [FieldOffset(0)] public ulong raw; }
    [StructLayout(LayoutKind.Sequential)]
    private struct Filter {
        public Guid key; public Display display; public uint flags; public IntPtr provider;
        public Blob providerData; public Guid layer, sublayer; public Value weight;
        public uint count; public IntPtr conditions; public Action action; public Context context;
        public IntPtr reserved; public ulong id; public Value effectiveWeight;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct Sublayer {
        public Guid key; public Display display; public uint flags; public IntPtr provider;
        public Blob providerData; public ushort weight;
    }
    [DllImport("fwpuclnt.dll", CharSet = CharSet.Unicode)]
    private static extern uint FwpmEngineOpen0(string server, uint auth, IntPtr identity, ref Session session, out IntPtr engine);
    [DllImport("fwpuclnt.dll")] private static extern uint FwpmEngineClose0(IntPtr engine);
    [DllImport("fwpuclnt.dll")] private static extern uint FwpmTransactionBegin0(IntPtr engine, uint flags);
    [DllImport("fwpuclnt.dll")] private static extern uint FwpmTransactionCommit0(IntPtr engine);
    [DllImport("fwpuclnt.dll")] private static extern uint FwpmTransactionAbort0(IntPtr engine);
    [DllImport("fwpuclnt.dll", CharSet = CharSet.Unicode)]
    private static extern uint FwpmSubLayerAdd0(IntPtr engine, ref Sublayer layer, IntPtr security);
    [DllImport("fwpuclnt.dll", CharSet = CharSet.Unicode)]
    private static extern uint FwpmFilterAdd0(IntPtr engine, ref Filter filter, IntPtr security, out ulong id);
    [DllImport("fwpuclnt.dll")] private static extern uint FwpmFilterGetById0(IntPtr engine, ulong id, out IntPtr filter);
    [DllImport("fwpuclnt.dll", CharSet = CharSet.Unicode)]
    private static extern uint FwpmGetAppIdFromFileName0(string file, out IntPtr blob);
    [DllImport("fwpuclnt.dll")] private static extern void FwpmFreeMemory0(ref IntPtr memory);
    [DllImport("iphlpapi.dll")] private static extern uint ConvertInterfaceGuidToLuid(ref Guid guid, out ulong luid);
    [DllImport("iphlpapi.dll")] private static extern uint ConvertInterfaceLuidToIndex(ref ulong luid, out uint index);

    private static readonly Guid Forward4 = new Guid("a82acc24-4ee1-4ee1-b465-fd1d25cb10a4");
    private static readonly Guid Forward6 = new Guid("7b964818-19c7-493a-b71f-832c3684d28c");
    private static readonly Guid Accept4 = new Guid("e1cd9fe7-f4b5-4273-96c0-592e487b8650");
    private static readonly Guid Accept6 = new Guid("a3b42c97-9f04-4672-b87e-cee9c483257f");
    private static readonly Guid SourceIndex = new Guid("2311334d-c92d-45bf-9496-edf447820e2d");
    private static readonly Guid ArrivalLuid = new Guid("618a9b6d-386b-4136-ad6e-b51587cfb1cd");
    private static readonly Guid AppId = new Guid("d78e1e87-8644-4ea5-9437-d809ecefc971");
    private static readonly Guid Protocol = new Guid("3971ef2b-623e-4f9a-8cb1-6e79b806b9a7");
    private static readonly Guid LocalPort = new Guid("0c1ba1af-5765-453f-af22-a8f791ac775b");
    private static readonly Guid RemotePort = new Guid("c35a604d-d22b-4e1a-91b4-68f674ee674b");
    private IntPtr engine;
    private readonly Guid sublayer = Guid.NewGuid();
    private readonly List<ulong> filters = new List<ulong>();
    private readonly Dictionary<Guid, uint> interfaces = new Dictionary<Guid, uint>();
    public int FilterCount { get { return filters.Count; } }
    public string[] InterfaceIds { get {
        var ids = new List<string>(); foreach (var id in interfaces.Keys) ids.Add(id.ToString()); return ids.ToArray();
    } }

    private static void Check(uint result) {
        if (result != 0) throw new InvalidOperationException("isolationFailed");
    }
    public static void ValidateLayout() {
        if (Marshal.SizeOf(typeof(Value)) != (IntPtr.Size == 8 ? 16 : 8) ||
            Marshal.SizeOf(typeof(Condition)) != (IntPtr.Size == 8 ? 40 : 28) ||
            Marshal.SizeOf(typeof(Filter)) != (IntPtr.Size == 8 ? 200 : 152))
            throw new InvalidOperationException("isolationFailed");
    }
    private static Condition Number(Guid key, uint type, uint number) {
        return new Condition { key = key, value = new Value { type = type, data = new Union { number = number } } };
    }
    private static Condition Pointer(Guid key, uint type, IntPtr pointer) {
        return new Condition { key = key, value = new Value { type = type, data = new Union { pointer = pointer } } };
    }

    public HotspotIsolation(string[] ids, string executable, int dnsPort, int httpsPort, int httpPort)
    {
        ValidateLayout();
        if (ids == null || ids.Length == 0 || ids.Length > 8 ||
            dnsPort < 1 || dnsPort > 65535 || httpsPort < 1 || httpsPort > 65535 || httpPort < 1 || httpPort > 65535)
            throw new InvalidOperationException("isolationFailed");
        IntPtr app = IntPtr.Zero, dhcp = IntPtr.Zero;
        bool transaction = false;
        try {
            var session = new Session { flags = 1, display = new Display { name = "PS5 Local Host hotspot" } };
            Check(FwpmEngineOpen0(null, 10, IntPtr.Zero, ref session, out engine));
            Check(FwpmTransactionBegin0(engine, 0)); transaction = true;
            var layer = new Sublayer { key = sublayer, weight = UInt16.MaxValue,
                display = new Display { name = "PS5 Local Host hotspot isolation" } };
            Check(FwpmSubLayerAdd0(engine, ref layer, IntPtr.Zero));
            Check(FwpmGetAppIdFromFileName0(executable, out app));
            Check(FwpmGetAppIdFromFileName0(System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "svchost.exe"), out dhcp));
            foreach (var text in ids) {
                Guid id = new Guid(text); ulong luid; uint index;
                Check(ConvertInterfaceGuidToLuid(ref id, out luid));
                Check(ConvertInterfaceLuidToIndex(ref luid, out index));
                if (index == 0 || interfaces.ContainsKey(id)) throw new InvalidOperationException("isolationFailed");
                interfaces.Add(id, index);
                IntPtr luidPointer = Marshal.AllocHGlobal(8);
                try {
                    Marshal.WriteInt64(luidPointer, unchecked((long)luid));
                    Add(Forward4, false, 0, new [] { Number(SourceIndex, 3, index) });
                    Add(Forward6, false, 0, new [] { Number(SourceIndex, 3, index) });
                    var arrival = Pointer(ArrivalLuid, 4, luidPointer);
                    Add(Accept4, false, 0, new [] { arrival });
                    Add(Accept6, false, 0, new [] { arrival });
                    // Soft permits in OUR sublayer: other Windows firewall policy still applies.
                    foreach (var port in new [] { dnsPort, httpsPort, httpPort })
                        Add(Accept4, true, 1, new [] { arrival, Pointer(AppId, 12, app),
                            Number(Protocol, 1, 6), Number(LocalPort, 2, (uint)port) });
                    Add(Accept4, true, 1, new [] { arrival, Pointer(AppId, 12, app),
                        Number(Protocol, 1, 17), Number(LocalPort, 2, (uint)dnsPort) });
                    Add(Accept4, true, 1, new [] { arrival, Pointer(AppId, 12, dhcp),
                        Number(Protocol, 1, 17), Number(LocalPort, 2, 67), Number(RemotePort, 2, 68) });
                    // IPv6 neighbour discovery only; no IPv6 application service is exposed.
                    foreach (uint type in new uint[] { 135, 136 })
                        Add(Accept6, true, 1, new [] { arrival, Number(Protocol, 1, 58), Number(LocalPort, 2, type) });
                } finally { Marshal.FreeHGlobal(luidPointer); }
            }
            Check(FwpmTransactionCommit0(engine)); transaction = false;
        } catch {
            if (transaction) FwpmTransactionAbort0(engine);
            Dispose(); throw;
        } finally {
            if (app != IntPtr.Zero) FwpmFreeMemory0(ref app);
            if (dhcp != IntPtr.Zero) FwpmFreeMemory0(ref dhcp);
        }
    }

    private void Add(Guid layer, bool permit, uint weight, Condition[] conditions)
    {
        int size = Marshal.SizeOf(typeof(Condition));
        IntPtr memory = Marshal.AllocHGlobal(size * conditions.Length);
        try {
            for (int i = 0; i < conditions.Length; i++)
                Marshal.StructureToPtr(conditions[i], IntPtr.Add(memory, i * size), false);
            var filter = new Filter { key = Guid.NewGuid(), layer = layer, sublayer = sublayer,
                display = new Display { name = "PS5 Local Host hotspot " + (permit ? "local service" : "block") },
                weight = new Value { type = 1, data = new Union { number = weight } },
                count = (uint)conditions.Length, conditions = memory,
                action = new Action { type = permit ? 0x1002U : 0x1001U } };
            ulong id; Check(FwpmFilterAdd0(engine, ref filter, IntPtr.Zero, out id)); filters.Add(id);
        } finally { Marshal.FreeHGlobal(memory); }
    }

    public void Verify(string[] currentIds)
    {
        if (engine == IntPtr.Zero || currentIds.Length != interfaces.Count) throw new InvalidOperationException("isolationFailed");
        foreach (var text in currentIds) {
            Guid id = new Guid(text); ulong luid; uint index, expected;
            if (!interfaces.TryGetValue(id, out expected)) throw new InvalidOperationException("isolationFailed");
            Check(ConvertInterfaceGuidToLuid(ref id, out luid)); Check(ConvertInterfaceLuidToIndex(ref luid, out index));
            if (index != expected) throw new InvalidOperationException("isolationFailed");
        }
        foreach (ulong id in filters) {
            IntPtr memory = IntPtr.Zero;
            try { Check(FwpmFilterGetById0(engine, id, out memory)); }
            finally { if (memory != IntPtr.Zero) FwpmFreeMemory0(ref memory); }
        }
    }

    public void Dispose() {
        if (engine == IntPtr.Zero) return;
        Check(FwpmEngineClose0(engine)); engine = IntPtr.Zero;
    }
}
