# PS5 Local Host

[简体中文](README.md) | [English](README.en.md)

PS5 Local Host is a desktop tool for local network testing. It runs DNS and web services on your computer so a PS5 can attempt to open web files you provide. It also offers user initiated downloads of third party components, ELF delivery, local PKG installation through PKG Manager, and FTP transfer of game folders or images.

> **Technical exchange and scope of use:** This project provides local network services and file transfer tools for technical discussion and authorized testing. Its repository and builds do not bundle PS5 exploits, jailbreak scripts, third party ELF files, or game content; third party components are downloaded only after a user action. Read the [disclaimer](#disclaimer) below. “Technical exchange” does not itself grant permission to access or modify a device or run third party content.

> **Verification status:** Core services and downloads have automated tests. The certificate prompt, page entry point, and subsequent behavior on PS5 firmware 13.60 still need testing on hardware. “PS5 HTTPS access” only means the app received a matching request.

## Features

| Feature | Description |
| --- | --- |
| Local web hosting | Download and check a user supplied GitHub repository or HTTPS ZIP, then host its web files over local HTTPS and HTTP. |
| DNS redirection | Answer A queries for a configured domain with the selected computer IPv4 address; other domains are not forwarded. |
| Component actions | Download fixed upstream WebKit Autoloader, PKG Manager, Kstuff FPKG, Payload Manager, FTP Server (drakmor), and PS5 Web File Manager release assets on request, check their pinned SHA-256 hashes, and send ELF files on request. |
| Local PKG installation | Select one `.pkg` on your computer and transfer it through PKG Manager Direct Install on the PS5. |
| Game folder / image transfer | Upload a complete game folder or an `.exfat` / `.ffpkg` image through FTP to `/data/homebrew/` on PS5. Completion does not confirm mounting or game startup. |
| Status and logs | Track services, PS5 HTTPS requests, downloads, and remote tasks separately. |

Components, web files, and PKGs are selected or obtained by the user and are not bundled with the app. Archive checks cover the URL, structure, and entry file, among other basic conditions; they are not a security audit of web scripts.

## Download and run

Download published versions from [Releases](https://github.com/MarcusYuan/ps5-lan-workbench/releases): a Windows x64 installer and portable executable, plus separate DMG and ZIP packages for macOS Intel (x64) and Apple Silicon (arm64), with a combined `SHA256SUMS.txt`. Pushing a `v*` tag matching the version in `package.json` builds and publishes a Release. Pushes to `main` and manual runs of [Build desktop packages](https://github.com/MarcusYuan/ps5-lan-workbench/actions/workflows/build.yml) produce time limited Actions artifacts only. The packages are unsigned; macOS Gatekeeper may block them.

To run from source, use Node.js 22.12 or later:

```bash
npm ci
node node_modules/electron/install.js
npm start
```

`npm ci` normally installs the Electron runtime; the `install.js` command can complete that download if necessary. See [Development and builds](#development-and-builds) for the other commands.

## Host a web page locally

1. Connect the computer and PS5 to the same local network. In the app, select the computer's IPv4 network interface that faces the PS5.
2. Under “File source,” enter a public GitHub repository root URL, such as `https://github.com/owner/repository`, or a direct HTTPS ZIP URL. Set the relative path of the web entry file inside the archive; the default is `index.html`. A Release page URL is not a direct ZIP URL.
3. Click “Download and verify.” For a GitHub repository, the app resolves the default branch to an exact commit before downloading the archive. Files go into the app's user data directory. A failed or canceled download retains the previous usable files.
4. Click “Start local services.” By default, the app listens on DNS UDP/TCP 53, HTTPS 443, and HTTP 8000. Grant any required system permission. An occupied port produces an error.
5. Set the PS5 primary DNS server to the computer IPv4 address shown in the app. Then try opening the page through the PS5 User's Guide entry point. The HTTP URL is for computer or local network testing only.
6. Check “PS5 HTTPS access” and the activity log. A received request does not prove that the PS5 trusts the self signed certificate or that a page or third party program ran successfully.

The app generates a self signed certificate with a SAN for the target domain and renews it when the domain changes or expiry approaches. It does not install the certificate as a system root.

## Components and local PKGs

1. Enter and save the PS5 IPv4 address separately at the top of the app. Saving it does not probe the console. The computer interface address remains the address for DNS and web hosting.
2. Under “Install components,” inspect the upstream source and download the component you need. The app verifies the pinned release asset's SHA-256 hash. Only when you click “Load on PS5” does it check the default port 9021 and send the ELF. Confirm WebKit Autoloader and Kstuff FPKG operation on the PS5; PKG Manager readiness is checked through its default port 8844.
3. Payload Manager v0.5.2 can be checked and its management page opened without a local ELF download. The app checks its version and service response on port 8084. Loading skips the send when it is already running; after a send the app waits up to 30 seconds for confirmation. Payload Manager may execute an existing console autoload list. This app does not change that list.
4. Under “Install a local PKG,” select or drop one `.pkg` from your computer and click “Install on PS5.” The app transfers it in segments through PKG Manager Direct Install. This needs no SMB share and does not depend on port 9021. Keep the computer and source file available until the PS5 reports an installation result.

On firmware 7.00–13.60, WebKit Autoloader's default ELF Loader may accept connections only from the PS5 itself. To send an ELF from a computer, first enable LAN connections according to the [upstream instructions](https://github.com/itsPLK/ps5-webkit-autoloader/blob/v0.5.1/README.md). Payload Manager and PKG Manager are different programs.

Pinned releases: WebKit Autoloader v0.5.1, PKG Manager v1.4.1, Kstuff FPKG 1.13-fpkg-dr-test5, Payload Manager v0.5.2, FTP Server (drakmor) 1.16-ng-stable, and PS5 Web File Manager v1.9. Download an older cached Autoloader again to pass the new checksum. Relapse in Autoloader v0.5.1 requires an active Wi-Fi or Ethernet connection, even without internet access.

After sending FTP Server, confirm startup on the console and connect an FTP client to the PS5 address on port 2121. After sending Web File Manager, open `http://<PS5-IP>:<reported-port>/` in your browser. Its default port is 8888 and it tries higher ports if occupied; use the startup notification. These two components report transmission only. This project has not verified their operation on firmware 13.40. Archive extraction requires the separately obtained upstream `wfm-7zip-helper.elf`; this app does not download or install that helper.

Kstuff now uses the user supplied [GBAtemp test5 attachment](https://gbatemp.net/attachments/kstuff-1-13-fpkg-dr-test5-elf-7z.593030/), extracted after download. Both the archive and ELF have pinned sizes and SHA-256 hashes computed from the downloaded files; these have not been compared with author published hashes. FPKG compatibility on firmware 13.40/13.60 is unverified. Download again to replace the old Lite 1.11 cache; the component ID stays compatible. GBAtemp downloads directly without the GitHub mirror.

### FTP transfer of game folders and images

1. Save the PS5 target address and start FTP Server on the console. Sending its ELF does not confirm FTP is running.
2. Under “Send game folder / image”, choose a complete game root folder or an existing `.exfat` / `.ffpkg` image. Folders must contain a nonempty `eboot.bin` and a `sce_sys/param.json` with a `titleId`. Symbolic links, directory junctions and unsafe filenames are rejected. Image selection checks the extension and basic file conditions, not internal game contents or compatibility. `.ffpkg` is an image, distinct from an FPKG installation package.
3. Check the FTP port (default 2121) and click “Send to PS5”. This feature uses anonymous FTP login without storing credentials, and requires a console service that permits that login method.
4. Files are staged under `/data/.ps5-local-host-<task-id>/`. After checking each remote file size, the app renames the completed folder or image into `/data/homebrew/<selected-name>`. Existing destinations are rejected; do not modify the destination with other tools during transfer. Size checking is not a content hash check. Source file changes stop the task.
5. Progress and cancellation appear in the task area. After failure or cancellation, the app attempts to remove only this task's temporary files; technical details record the staging path when cleanup fails. A lost connection during the final rename produces an unconfirmed result that needs checking on PS5. Resume, overwrite updates, storage destination selection and image creation are not available yet.
6. Confirm recognition, mounting and startup through a compatible console loader such as ShadowMountPlus. Prepare that loader separately; this app does not automatically download, start or verify it. Firmware 13.00 and individual game compatibility still require hardware testing.

### GitHub mirror

“GitHub mirror acceleration” under “File source” is off by default. When enabled, new downloads of public GitHub repository API responses, ZIPs, and component assets go through the third party `gh-proxy.org` service. Changing the setting does not interrupt a current task or change DNS, HTTPS, or PS5 connections. The mirror provider receives the requested public resource URL. The app does not route account credentials, URLs with query parameters, or ZIPs from other sites through the mirror. Component SHA-256 checks still apply. Ordinary web ZIPs have no pinned trusted hash, so assess the source and mirror yourself. If the mirror fails, turn it off and retry.

## Network and local data

| Area | Behavior |
| --- | --- |
| DNS | Only A queries for the target domain (default `manuals.playstation.net`) receive the selected computer IPv4 address. AAAA has no address; other domains return NXDOMAIN. Public DNS requests are not forwarded. |
| Web | HTTPS and HTTP serve the same downloaded files. `/document/<language>/ps5/` redirects to the selected entry file; missing files return 404. |
| Internet requests | The app contacts upstream sources only for user initiated downloads. User provided pages or scripts may make their own external requests. |
| PS5 connections | The app contacts the saved PS5 address when the user requests ELF delivery, PKG installation, game folder / image transfer, or a component status check. |
| Local storage | Configuration, downloaded files, and certificate private keys live in Electron's user data directory, outside the package. Services must be started manually after relaunch. |

To check whether a page works offline, disconnect the computer from the internet after downloading and starting the services, while keeping its local connection to the PS5.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Services will not start | Check the selected interface, system permissions, and whether another DNS, proxy, or app occupies ports 53, 443, or 8000. |
| The PS5 cannot open the page | Check that both devices are on the same LAN, that the PS5 primary DNS points to the selected computer IPv4 address, and that HTTPS requests appear in the log. Certificate and page behavior still need hardware confirmation. |
| A download fails | Check the GitHub repository or direct HTTPS ZIP URL and the relative entry path. If using the mirror, turn it off and retry. |
| ELF or PKG action fails | Check the saved PS5 IPv4 address, the relevant service on port 9021 or 8844, and the task log. |

If port 53 is occupied, use `--diagnostic-ports` for temporary computer side tests on DNS 5354, HTTPS 8443, and HTTP 18000:

```bash
npm start -- --diagnostic-ports
```

The same flag can be appended when launching a packaged app from a command line. Diagnostic mode cannot be used for PS5 access because the PS5 DNS setting cannot specify port 5354. A normal relaunch restores the default ports.

## Development and builds

```bash
npm test
npm run pack:dir
npm run pack:mac
npm run pack:win
```

`pack:mac` produces a DMG and ZIP on macOS; `pack:win` produces an NSIS installer and portable executable on Windows. Distributors need their own credentials for macOS signing and notarization and Windows signing. `npm test` uses ordinary test pages and high local ports to cover downloads, DNS, HTTPS, static resources, certificate reuse, and port release. Automated tests do not replace PS5 hardware verification.

## Disclaimer

This project is solely for technical exchange, learning, and local network testing in a legally authorized environment. Use it only with devices, accounts, and networks you own or are explicitly authorized to use. Follow applicable laws, platform terms, and third party licenses. **“Technical exchange” or “research” describes the project's purpose; it does not authorize a particular action or remove the user's legal responsibilities.**

- **Project and content:** This is an independent, unofficial tool. It is not affiliated with, authorized by, partnered with, or endorsed by Sony Interactive Entertainment, PlayStation, or the listed third party projects. Names are used only to identify compatible products or upstream sources; trademarks belong to their respective owners. The repository and builds do not include exploits, jailbreak scripts, third party ELFs, or game content.
- **Third party resources:** Users choose or initiate the use of pages, scripts, ELFs, PKGs, and download mirrors. Check their sources, licenses, terms, and safety yourself. The ability to download, hash check, or host a file is not an audit, recommendation, or guarantee of its legality, safety, compatibility, or effect. A matching hash cannot replace those judgments.
- **Results and risks:** Starting a service, receiving a PS5 request, sending an ELF, or completing a file transfer does not establish that third party content executed or installed successfully. The project is provided as is, without a guarantee of compatibility with every device or firmware, continuous availability, or fault free operation. Use of the tool or third party content may cause network problems, data loss, device faults, or account restrictions. Back up important data first.
- **Liability:** To the extent permitted by applicable law, the authors and contributors are not liable for losses arising from use or inability to use this project, or from third party content users choose, download, host, or run. This statement does not exclude liability that cannot legally be excluded, and it does not replace this project's [MIT License](LICENSE) or third party licenses and terms.

If you cannot accept these conditions and risks, do not use the tool. Report infringement or distribution concerns through an [Issue](https://github.com/MarcusYuan/ps5-lan-workbench/issues), without including passwords or certificate private keys.

## Contact and community

| Channel | Contact | Purpose |
| --- | --- | --- |
| QQ group | `672608984` | Technical and usage discussion in Chinese |
| Discord | [PS5 Technical Exchange](https://discord.gg/3UrdCB47Q8) | Technical and usage discussion |
| GitHub Issues | [Report an issue or suggest a feature](https://github.com/MarcusYuan/ps5-lan-workbench/issues) | Bug reports, feature requests, and project questions |

When reporting a problem, include the app version, operating system, steps to reproduce, and redacted logs. Do not share passwords, private keys, or other sensitive information publicly.

## License

The project's code is under the [MIT License](LICENSE). Third party components downloaded on request are governed by their upstream licenses.
