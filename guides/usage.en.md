# Detailed usage and development guide

[Back to README](../README.en.md) | [简体中文](usage.zh-CN.md)

## Automatic IP configuration and cleanup

This section applies to single- and two-adapter modes. For mode 3, follow Windows local hotspot below and the README's hotspot steps instead of this fixed-IP procedure.

“Connection mode and computer IP setup” offers single-adapter (shared router) and two-adapter (separate adapter wired to PS5) modes. Select a physical adapter and service IP, click “Configure IP automatically,” and complete system authorization. The default is `192.168.100.1/24`; another private IPv4 address ending in `.1` can be used. The mask is fixed at `255.255.255.0`, with `.2` suggested for PS5. Success selects the added address for local services. Enter the PS5 settings manually and save its address in the app.

Single-adapter mode uses the connected internet adapter with an existing IPv4 address and default gateway, with the computer and PS5 on the same router. Disable AP/client isolation; guest networks and other policies may prevent communication. Two-adapter mode uses the adapter wired to PS5, without a default gateway. Set PS5 primary DNS and gateway to the computer's service IP for local connectivity only; this does not forward internet traffic. Existing computer addresses, DHCP, gateway and DNS are preserved.

Clear the app-added configuration before switching modes, then select the new mode and adapter. The interface and configuration helper share preflight checks: they identify the overlapping adapter, original address and prefix, or route and its interface. **Use suggested IP** is offered when a candidate subnet passes the computer checks. Clicking it fills the input only; click **Configure IP automatically** to apply it, manually update PS5 IP, gateway and primary DNS using the revised hint, and save the PS5 address in the app. The helper checks the live network again after authorization. Suggestions do not guarantee that the LAN address is unused or PS5 is reachable.

For example, an original WLAN address of `192.168.3.102/8` covers `192.168.100.x`. Clearing the single-adapter `.100.1` addition preserves that original `/8`, so adding `.100.1` to another adapter still overlaps. Use a checked alternative such as `172.31.253.1/24`. Preserve the original internet mask rather than deleting original addresses or changing routes to bypass the overlap. Errors from a previous configuration input are not applied to a newly selected mode, adapter or IP.

Stop local services, downloads, transfers and remote tasks before changes. The app checks actual adapters, addresses and overlapping subnets on other adapters and Windows routes. Windows duplicate-address detection is also checked. These checks cannot guarantee an unused address or unrestricted LAN access; hardware verification is still required. A pre-existing matching address is used without claiming ownership. If an adapter or route has an overlapping subnet, including a broader mask, choose a different private subnet and adjust PS5 settings accordingly.

Windows uses temporary DHCP/static-address coexistence. If the adapter already has a usable address, the added address skips automatic source selection to preserve normal internet source selection. An otherwise unaddressed direct-connect adapter can use the added address for outbound connections. If coexistence cannot be verified, configuration stops. macOS uses a temporary IPv4 alias. Added addresses and app-modified coexistence settings last for the current boot only. Closing the app retains them; configure again after restarting the computer.

“Clear app-added configuration” uses `network-config.json` in the app's user data directory to identify the adapter and address. It removes the app-added address and restores coexistence enabled by the app. It does not reset the adapter, restore an entire old network snapshot or delete pre-existing IPs. If another application has since added a static address requiring coexistence, the setting and cleanup record are retained with an explanation. After a reboot, old records are discarded without deleting current addresses.

Interrupted operations, canceled authorization and failed recovery retain the record. On the next launch, inspect the message and clear the app-added configuration before retrying. Changes to existing internet settings or unconfirmed results are not reported as success; check system network settings. Do not manually delete the record and repeatedly configure. Validation includes simulated commands and failure scenarios for both platforms, plus actual address addition and cleanup on Ethernet and Wi-Fi on one Windows computer. Tests used the application configuration module and helper process, verified local TCP communication through the added address and public HTTPS requests, and confirmed restoration of original IP, DHCP, gateway, DNS and coexistence settings after cleanup. An initially unaddressed direct-connect adapter, macOS hardware operation, expiration after reboot and PS5-side connectivity remain unverified.

## Three connection modes

Start with [Connection and IP settings in the README](../README.en.md#connection-and-ip-settings). Single- and two-adapter modes use Configure IP automatically; Windows local hotspot uses Start local hotspot and an assigned address. All three preserve existing computer internet settings. The diagram separates their topology, settings and shutdown instructions.

![Three modes: add a service IP with single or two adapters, or use Windows-assigned hotspot addressing](assets/connection-modes.en.png)

- **Single adapter:** connect the computer and PS5 to the same router. The service IP is added to the computer's current internet adapter. PS5 can connect to that router by Wi-Fi or cable; client isolation may block local traffic.
- **Two adapters:** keep one computer adapter connected to the internet and cable another Ethernet adapter directly to PS5. Add the service IP to the direct-connect adapter. The internet adapter stays unchanged; the computer-to-PS5 cable does not pass through a router.
- **Local hotspot:** Windows experimental only. A compatible adapter broadcasts Wi-Fi for PS5 to connect directly. Use automatic IP and primary DNS pointing to the actual hotspot address, then verify and save the assigned PS5 IP. No fixed service IP or internet sharing is added; closing the app stops the hotspot. PS5 association and client-side isolation remain unverified.
- **PS5 settings for modes 1 and 2:** default IP `192.168.100.2`, mask `255.255.255.0`, and primary DNS and gateway both set to computer service IP `192.168.100.1`. Enter these console settings manually and save the same PS5 address in the app. Update these values together when changing the service subnet. This table does not apply to hotspots.

Adding an IP does not share internet access. The app does not enable bridging or internet forwarding, change PS5 network settings or disable updates. Disable automatic system software downloads and installation on the console yourself. Configure temporary addresses again after a computer restart; clearing the computer's additions does not reset PS5 settings.

Initial downloads need internet access on the computer. Cached pages, components and local files can use the LAN; external dependencies of pages or third-party components depend on those resources. The connection diagram above is Figure 1; [see Figure 2 for the complete seven-step workflow and each step's purpose](../README.en.md#seven-steps-from-setup-to-playing).

## Windows local hotspot (experimental)

Hotspot mode uses autonomous group owner and legacy access point settings on Windows `WiFiDirectAdvertisementPublisher`. It does not invoke Mobile hotspot or enable ICS/NAT. The restricted preload exposes start/stop only; both the main and helper processes validate credentials. Names accept 1–32 ASCII letters, digits, spaces, underscores or hyphens, starting with a letter or digit. Passwords accept 8–63 printable ASCII characters without spaces. Credentials travel through local IPC/stdin, never configuration files, logs or command arguments.

The Windows helper compiles this project's native interface source with the built-in .NET Framework; no dependency download or installed SDK is required. Compatible Windows components, Wi-Fi hardware and drivers are needed. macOS retains the original two connection modes. Clear app-added IPs first; hotspot and added-IP configuration cannot be active together.

Before broadcasting, a WFP dynamic session installs rules for currently unused Wi-Fi Direct candidate interfaces. A separate sublayer blocks IPv4/IPv6 forwarding by source interface without changing forwarding on other adapters, including Clash/Mihomo. Active Wi-Fi Direct connections, ICS sharing and bridges remain conservative conflicts. Missing candidate interfaces or failed rule installation prevent broadcasting. Interface identity, rule presence, sharing and bridges are checked approximately every two seconds and rules are checked before accepting peers. Failed checks or new/recreated interfaces stop the hotspot rather than expanding its scope automatically.

New local connections arriving through the hotspot are denied by default. Exceptions match this app’s executable plus DNS TCP/UDP 53, HTTPS TCP 443 and HTTP TCP 8000 (actual configured ports in diagnostic mode), system svchost DHCP UDP 67→68, and necessary IPv6 neighbour discovery. Computer-initiated PS5 sessions rely on WFP state tracking; uploads and component management do not require opening all inbound ports. This restricts hotspot clients from using other programs’ HTTP/SOCKS proxies on the computer. Soft permits do not override Windows or third-party firewall blocks; local services may still require firewall permission.

Shutdown releases the access point and peers before closing WFP. Dynamic rules are removed when the session or helper process ends, without persistent policy or changes to original adapter IP/gateway/DNS. Identity checks have an interval and cannot guarantee immediate isolation against administrator changes or third-party kernel drivers. Bridging that bypasses the IP forwarding layer and arbitrary VPN injection are unsupported. The DNS whitelist is not a substitute for interface isolation. References: [WFP layer conditions](https://learn.microsoft.com/en-us/windows/win32/fwp/filtering-conditions-available-at-each-filtering-layer), [dynamic session lifetimes](https://learn.microsoft.com/en-us/windows/win32/fwp/object-management).

Broadcasting, obtaining a local address, accepting a peer, starting DNS/web services and actual PS5 execution are separate states. Use the private IPv4 assigned by Windows, not the adapter mode's `192.168.100.1`. If no address is available, connect PS5 with automatic IP first, wait for the computer address, then set primary DNS manually. Start local services separately; while the hotspot is active, services use only its address. An observed peer is not identified as PS5; verify its address on the console, select it from connected devices and confirm. The target address is not overwritten automatically.

Stopping the hotspot or exiting the app releases the owned access point and connections. Address changes or hotspot failure stop local services and cancel active remote operations. Unconfirmed shutdown is reported as a failure. Firewalls, occupied ports 53/443, sleep and wireless drivers can affect local access; inspect system messages. Disable PS5 updates yourself. Native compilation and automated tests do not verify hotspot hardware operation, PS5 connectivity or internet isolation.

On one Windows computer with an RZ616 Wi-Fi adapter, validation covered native hotspot startup, an actual IPv4 address, local DNS queries on UDP 53, local HTTPS access on port 443, and shutdown. Original physical adapter IP/DNS/gateway/DHCP settings were preserved. The new implementation was tested while Mihomo IPv4 forwarding remained enabled: 22 dynamic WFP rules were installed and checked across two unused Wi-Fi Direct candidate interfaces, the hotspot obtained 192.168.137.1, local DNS/HTTPS checks passed, and shutdown completed with original physical adapter settings preserved. This verifies rule installation, hotspot lifetime and local services only; it does not verify actual traffic isolation from a hotspot client, PS5 association, Clash proxy operation, other adapters or macOS.

Hotspot mode adds “View connected devices”. About every two seconds, the helper enumerates IP endpoints of currently connected devices and offers multiple addresses for selection. This does not read DHCP leases, scan the LAN or establish PS5 identity. After checking the address on the console, use “Confirm as PS5” to save the target and authorize service startup for this hotspot session. A previously saved IP alone is insufficient; the main process also checks confirmation, membership and freshness.

Stop local services and finish or cancel remote tasks before selecting again. If the selected device disappears or the list has not updated for eight seconds, cancel remote operations, stop services and revoke confirmation. Other devices remain selectable without automatically replacing the target. Closing, failure, address changes and restarting the hotspot require renewed confirmation. Windows initially defaults to hotspot and macOS to single adapter; the mode preference is saved, and selecting a mode does not start a hotspot.

## Host a web page locally

1. Configure your selected mode: choose the added service IP for modes 1 and 2 (default `192.168.100.1`), or use the automatically selected actual hotspot IP. Hotspot broadcasting and local service startup are separate operations.
2. “File source” is prefilled with `https://github.com/ntfargo/Relapse-Exploit` on first launch or when the saved URL is empty. The default entry file is `index.html`; saved custom URLs and the source of downloaded content are retained. Check the selected repository's firmware compatibility; prefilling does not confirm PS5 hardware compatibility. You can use another public GitHub repository root URL or direct HTTPS ZIP URL and set the relative entry path inside the archive. A Release page URL is not a direct ZIP URL. Prefilling does not trigger a download.
3. Click “Download and verify.” For a GitHub repository, the app resolves the default branch to an exact commit before downloading the archive. Files go into the app's user data directory. A failed or canceled download retains the previous usable files.
4. Click “Start local services.” By default, the app listens on DNS UDP/TCP 53, HTTPS 443, and HTTP 8000. Grant any required system permission. An occupied port produces an error.
5. Set PS5 primary DNS to the current computer service IP (default `192.168.100.1` in modes 1 and 2; use the displayed hotspot address in mode 3). Avoid public secondary DNS. Open Settings → Guide & Tips, Health & Safety, and Other Information → User's Guide and follow the selected repository. Menu names can vary with firmware or language. The HTTP URL is for computer or local network testing only.
6. Check “PS5 HTTPS access” and the activity log. A received request does not prove that the PS5 trusts the self signed certificate or that a page or third party program ran successfully.

The app generates a self signed certificate with a SAN for the target domain and renews it when the domain changes or expiry approaches. It does not install the certificate as a system root.

## Components and local PKGs

1. Enter and save the actual PS5 IPv4 address separately (default `192.168.100.2` in modes 1 and 2; check the assigned address on the console in hotspot mode). Confirm that ELF Loader accepts computer connections after injection. Saving the address does not probe PS5. DNS/web services use either the added adapter IP or the actual hotspot IP. Recheck both addresses after changing subnets or restarting the hotspot.
2. Under “Install components,” inspect the upstream source and download the component you need. The app verifies the pinned release asset's SHA-256 hash. Only when you click “Load on PS5” does it check the default port 9021 and send the ELF. Confirm WebKit Autoloader and Kstuff FPKG operation on the PS5; PKG Manager readiness is checked through its default port 8844.
3. Payload Manager v0.5.2 can be checked and its management page opened without a local ELF download. The app checks its version and service response on port 8084. Loading skips the send when it is already running; after a send the app waits up to 30 seconds for confirmation. Payload Manager may execute an existing console autoload list. This app does not change that list.
4. Under “Install a local PKG,” select or drop one `.pkg` from your computer and click “Install on PS5.” The app transfers it in segments through PKG Manager Direct Install. This needs no SMB share and does not depend on port 9021. Keep the computer and source file available until the PS5 reports an installation result.

On firmware 7.00–13.60, WebKit Autoloader's default ELF Loader may accept connections only from the PS5 itself. To send an ELF from a computer, first enable LAN connections according to the [upstream instructions](https://github.com/itsPLK/ps5-webkit-autoloader/blob/v0.5.2/README.md). Payload Manager and PKG Manager are different programs.

Pinned releases: WebKit Autoloader v0.5.2, PKG Manager v1.4.1, Kstuff FPKG 1.13-fpkg-dr-test5, Payload Manager v0.5.2, ShadowMountPlus 1.7beta2 (default) / 1.7beta3 (optional pre-release), FTP Server (drakmor) 1.16-ng-stable, and PS5 Web File Manager v1.9. Download an older cached Autoloader again to pass the new checksum. Relapse in Autoloader v0.5.2 requires an active Wi-Fi or Ethernet connection, even without internet access.

[Autoloader v0.5.2](https://github.com/itsPLK/ps5-webkit-autoloader/releases/tag/v0.5.2) removes the splash screen so loader and exploit logs appear as soon as the shortcut opens. Upstream also simplifies firmware detection and automatically selects Poops for 9.05 / 11.40. The app fetches the new version only when you click “Download”; existing PS5 installations do not update automatically. Follow upstream instructions to load the installer and confirm the result on the console. The new ELF size and SHA-256 match GitHub asset metadata; firmware compatibility still needs hardware verification.

After sending FTP Server, confirm startup on the console and connect an FTP client to the PS5 address on port 2121. After sending Web File Manager, open `http://<PS5-IP>:<reported-port>/` in your browser. Its default port is 8888 and it tries higher ports if occupied; use the startup notification. These two components report transmission only. This project has not verified their operation on firmware 13.40. Archive extraction requires the separately obtained upstream `wfm-7zip-helper.elf`; this app does not download or install that helper.

Kstuff now uses the user supplied [GBAtemp test5 attachment](https://gbatemp.net/attachments/kstuff-1-13-fpkg-dr-test5-elf-7z.593030/), extracted after download. Both the archive and ELF have pinned sizes and SHA-256 hashes computed from the downloaded files; these have not been compared with author published hashes. FPKG compatibility on firmware 13.40/13.60 is unverified. Download again to replace the old Lite 1.11 cache; the component ID stays compatible. GBAtemp downloads directly without the GitHub mirror.

### Y2JB Autoloader installation

This is an FTP installer for an already jailbroken PS5. It does not depend on port 9021; an anonymous FTP service with access to `/user/download` must be running (default port 2121). Prepare a compatible YouTube app, account and update blocking according to the [upstream setup instructions](https://github.com/itsPLK/ps5-y2jb-autoloader#setup-instructions). The app does not install YouTube PKGs, change accounts or system databases, or restore system backups.

- Default choice: [v0.9.1 stable release](https://github.com/itsPLK/ps5-y2jb-autoloader/releases/tag/v0.9.1-36381e4). This predates Relapse; its release notes require another kernel exploit above 12.70. Newer YouTube userland support does not establish full jailbreak support.
- Optional: [v1.0.0-dev-794049f](https://github.com/itsPLK/ps5-y2jb-autoloader/releases/tag/v1.0.0-dev-794049f). Relapse targets firmware 10.20–13.60 and is an early pre-release needing testing. Neither version has been hardware-tested by this project.
- Both `download0.dat` assets are 336,789,504 bytes, downloaded only on request and cached separately. Pinned sizes and SHA-256 hashes match GitHub release asset metadata. Neither is bundled with the app.

Save the PS5 address, then choose the version, installed YouTube title ID (PPSA01650 / PPSA01651 / PPSA01652) and FTP port. Fully close YouTube, confirm preparation and click “Install through FTP.” Downloading alone does not change the PS5.

The installer uploads a uniquely named temporary file under `/user/download/<title ID>/`, then reads the entire upload back through FTP to verify SHA-256, adding about 321 MiB of return traffic. After verification, any existing `download0.dat` is renamed to `download0.dat.backup-<unique ID>` before the new file is activated. Keeping the backup and new file needs extra free space; the UI shows the backup path. Existing autoload settings and payloads are preserved.

An upload or verification failure leaves the original in place and attempts staging cleanup. If replacement fails, the app reconnects and attempts to restore the backup only when the destination is missing and the backup exists. A lost replacement acknowledgement leaves the result unconfirmed and retains relevant files. Close YouTube and inspect the destination, backup and staging paths shown in the UI over FTP. If necessary, retain the current file before restoring the backup as `download0.dat`; do not repeatedly install while the result is unconfirmed. Cleanup or recovery may also fail if FTP disconnects, requiring manual inspection.

“Files installed” confirms FTP deployment only. Open YouTube on PS5 to verify execution; the entry point must still run after each restart. Without `autoload.txt`, Payload Manager starts and can configure the desired payloads to autoload. Existing `autoload.txt` affects startup and USB configuration takes priority. To work without USB, place the configuration and payloads on internal storage as documented upstream. This installer does not automatically add other PC-cached components to autoload or guarantee compatibility between payloads.

### ShadowMountPlus image loading

The app supports user-initiated download, verification and delivery of `shadowmountplus.elf` from [ShadowMountPlus 1.7beta2](https://github.com/drakmor/ShadowMountPlus/releases/tag/1.7beta2). The ELF is not bundled. Its pinned size and SHA-256 were checked against the GitHub release asset. Upstream lists Kstuff-lite v1.07+ as its runtime environment and declares support through firmware 13.60 for the 1.7 series. This project has not verified specific firmware, games or the current Kstuff FPKG test-version combination.

The version selector defaults to **1.7beta2** and also offers [1.7beta3 (pre-release)](https://github.com/drakmor/ShadowMountPlus/releases/tag/1.7beta3). Beta3 size and SHA-256 match GitHub asset metadata. Upstream changes include backport mounting fixes with custom scan paths, ffpfsc mount parameter changes, and no automatic icon creation when the API is disabled. This update is not a confirmed fix for launch black screens; beta3 gameplay has not been verified on hardware.

To try it, fully close the game on PS5, select beta3 in the ShadowMountPlus card → “Download” → “Load on PS5”, then check console startup notifications and logs. Each version is cached and verified separately; selecting a version alone does not download or send anything. To return to beta2, select it and load the verified cache, or download it first if unavailable. Switching only changes the ELF being sent; it does not restore PS5 settings or data. Changing the component does not require uploading the game again.

1. Prepare an ELF Loader accepting computer connections and a compatible Kstuff environment on PS5.
2. Fully close the game first. Under “Install components,” select the ShadowMountPlus version, then click “Download” → “Load on PS5.” Check for the ShadowMount+ startup notification on the console. “ELF sent” confirms transfer only; the app does not confirm service operation or scanning through the API.
3. Uploaded images should be at `/data/homebrew/<filename>`, such as `/data/homebrew/PPSA22999.exfat`. ShadowMountPlus scans `/data/homebrew` by default. If `/data/shadowmount/config.ini` contains `scanpath` entries, only custom scan roots are used; include that directory.
4. Place `sce_sys/param.json` and game files at the image root, without an extra directory layer. Wait for scanning and registration notifications, then try launching on PS5. By default, images mount on demand at game startup; upload completion does not establish registration or successful execution.
5. If the startup notification is missing, check the ELF Loader. If a game entry is missing or startup fails, inspect `/data/shadowmount/debug.log` and console notifications, then check scan roots, image layout, integrity and runtime compatibility. Loading the component does not require re-uploading an existing image.

The upstream management API defaults to PS5 loopback `127.0.0.1:10101`. This app does not automatically change its listener settings or offer remote scanning or mount control. Upstream warns that mounting images may cause shutdown problems or data corruption; back up important data before use. [Upstream usage and troubleshooting](https://github.com/drakmor/ShadowMountPlus/blob/1.7beta2/README.md)

### FTP transfer of game folders and images

1. Save the PS5 target address and start FTP Server on the console. Sending its ELF does not confirm FTP is running.
2. Under “Send game folder / image”, choose a complete game root folder or an existing `.exfat` / `.ffpkg` image. Folders must contain a nonempty `eboot.bin` and a `sce_sys/param.json` with a `titleId`. Symbolic links, directory junctions and unsafe filenames are rejected. Image selection checks the extension and basic file conditions, not internal game contents or compatibility. `.ffpkg` is an image, distinct from an FPKG installation package.
3. Check the FTP port (default 2121) and click “Send to PS5”. This feature uses anonymous FTP login without storing credentials, and requires a console service that permits that login method.
4. Files are staged under `/data/.ps5-local-host-<task-id>/`. After checking each remote file size, the app renames the completed folder or image into `/data/homebrew/<selected-name>`. Existing destinations are rejected; do not modify the destination with other tools during transfer. Size checking is not a content hash check. Source file changes stop the task.
5. Progress and cancellation appear in the task area. After failure or cancellation, the app attempts to remove only this task's temporary files; technical details record the staging path when cleanup fails. A lost connection during the final rename produces an unconfirmed result that needs checking on PS5. Resume, overwrite updates, storage destination selection and image creation are not available yet.
6. Follow the [image loading steps](#shadowmountplus-image-loading) to confirm ShadowMountPlus scanning, registration and startup on PS5. You can explicitly download and send it under “Install components”; the app does not do so automatically or verify console mount results. Firmware 13.00 and individual game compatibility still require hardware testing.

### Garlic SaveMgr save management

The app downloads and sends the ELF from [GitHub release v1.7](https://github.com/earthonion/garlic-savemgr/releases/tag/v1.7). Pinned size and SHA-256 were checked against GitHub asset metadata. The existing GitHub mirror option applies; the ELF is not bundled. This version refers to the GitHub Release, not the latest version on other branches or publishing sites.

1. Jailbreak the PS5 and start a LAN-accessible ELF Loader. Save the correct PS5 IPv4 address and ELF port (default 9021).
2. Find Garlic SaveMgr under “Install components”, explicitly click “Download”, then “Load to PS5” after verification. Sending the ELF does not confirm service startup.
3. Click “Open save manager” to open the saved PS5 address on fixed port 8082 in the system browser, for example `http://192.168.1.100:8082/`. You can also enter the URL manually. Opening it does not check service identity or health. If unreachable, check the address, LAN access and console startup result.
4. In the upstream web UI, select a user and game, export a backup, then browse, edit or import as needed. The third-party program on PS5 processes saves; this app does not read or modify save contents, verify backup recoverability, or confirm that a game accepts edited saves.

The local management workflow does not require Garlic Worker, which serves an online save-processing service and is not integrated here. Firmware compatibility (including 13.60), backup, restore and resign behavior await hardware testing. [Upstream usage](https://github.com/earthonion/garlic-savemgr#usage)

### GitHub mirror

“GitHub mirror acceleration” under “File source” is off by default. When enabled, new downloads of public GitHub repository API responses, ZIPs, and component assets go through the third party `gh-proxy.org` service. Changing the setting does not interrupt a current task or change DNS, HTTPS, or PS5 connections. The mirror provider receives the requested public resource URL. The app does not route account credentials, URLs with query parameters, or ZIPs from other sites through the mirror. Component SHA-256 checks still apply. Ordinary web ZIPs have no pinned trusted hash, so assess the source and mirror yourself. If the mirror fails, turn it off and retry.

## Network and local data

| Area | Behavior |
| --- | --- |
| DNS | Only a single IN-class question matching the configured domain exactly (default `manuals.playstation.net`) is answered: A receives the selected computer IPv4 and AAAA returns no address. Other domains and subdomains return NXDOMAIN, unsupported types/classes return REFUSED, and multiple questions return FORMERR. UDP/TCP use the same rules; queries are never forwarded to public DNS. Do not configure public secondary DNS on PS5. This whitelist does not replace network-level internet isolation. |
| Web | HTTPS and HTTP serve the same downloaded files. `/document/<language>/ps5/` redirects to the selected entry file; missing files return 404. |
| Internet requests | The app contacts upstream sources only for user initiated downloads. User provided pages or scripts may make their own external requests. |
| PS5 connections | The app contacts the saved PS5 address when the user requests ELF delivery, PKG installation, game folder / image transfer, or a component status check. |
| Local storage | Configuration, downloaded files, and certificate private keys live in Electron's user data directory, outside the package. Services must be started manually after relaunch. |

To check whether a page works offline, disconnect the computer from the internet after downloading and starting the services, while keeping its local connection to the PS5.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Services will not start | Check the selected interface, system permissions, and whether another DNS, proxy, or app occupies ports 53, 443, or 8000. |
| The PS5 cannot open the page | Check the cable or router client communication. In hotspot mode, confirm PS5 joins the correct Wi-Fi, obtains its IP automatically and uses the actual displayed hotspot IP as primary DNS. Start services separately and check the HTTPS log. Certificate and page behavior still need hardware confirmation. |
| Hotspot cannot start or has no address | Check Windows, Wi-Fi hardware/driver support and authorization. Clear app-added IPs and stop existing Mobile hotspot, ICS sharing or bridges first. Follow isolation errors rather than bypassing rules manually. |
| Hotspot fails with Clash enabled | Forwarding on other adapters alone no longer prevents startup. Check for sharing, bridges or occupied local service ports. Installed rules do not establish PS5 association or client-side proxy isolation. |
| A download fails | Check the GitHub repository or direct HTTPS ZIP URL and the relative entry path. If using the mirror, turn it off and retry. |
| ELF or PKG action fails | Check the saved PS5 IPv4 address, the relevant service on port 9021 or 8844, and the task log. |

If port 53 is occupied, use `--diagnostic-ports` for temporary computer side tests on DNS 5354, HTTPS 8443, and HTTP 18000:

```bash
npm start -- --diagnostic-ports
```

The same flag can be appended when launching a packaged app from a command line. Diagnostic mode cannot be used for PS5 access because the PS5 DNS setting cannot specify port 5354. A normal relaunch restores the default ports.

## Run from source

Use Node.js 22.12 or later:

```bash
npm ci
npm start
```

If the Electron download is incomplete, run `node node_modules/electron/install.js`, then try again.

## Development and builds

```bash
npm test
npm run pack:dir
npm run pack:mac
npm run pack:win
```

`pack:mac` produces a DMG and ZIP on macOS; `pack:win` produces an NSIS installer and portable executable on Windows. Distributors need their own credentials for macOS signing and notarization and Windows signing. `npm test` uses ordinary test pages and high local ports to cover downloads, DNS, HTTPS, static resources, certificate reuse, and port release. Automated tests do not replace PS5 hardware verification.
