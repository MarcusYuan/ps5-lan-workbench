# PS5 Local Host

[简体中文](README.md) | [English](README.en.md)

Host local injection pages, manage components and install authorized local game files from your computer. Connect the computer and PS5 to the same router with one network adapter, or use a separate Ethernet adapter for a direct cable connection.

**[Download the latest version](https://github.com/MarcusYuan/ps5-lan-workbench/releases/latest)** · [Detailed guide](guides/usage.en.md) · [Contact and feedback](#contact-and-community)

> For technical exchange and authorized testing. Web resources, third-party ELFs, and game content are not bundled. PS5 hardware compatibility still requires verification; a completed transfer does not confirm successful execution on the console.

## Download and open

Expand **Assets** on the download page and choose a package for your computer:

| Your computer | Filename contains | How to open |
| --- | --- | --- |
| 64-bit Windows | `windows-x64-setup.exe` | Install, then launch |
| 64-bit Windows, portable use | `windows-x64-portable.exe` | Launch directly |
| Mac with Apple silicon (M series) | `macos-arm64.dmg` | Open the DMG and drag the app into Applications |
| Mac with an Intel processor | `macos-x64.dmg` | Open the DMG and drag the app into Applications |

ZIP packages are also available for macOS. **Source code contains the source files; choose an app package from the table.** Builds are unsigned and macOS builds are not notarized, so your system may block opening them.

## Connection and IP settings

Choose a mode in “Connection mode and computer IP setup”:

| Mode | Connection | Adapter to select |
| --- | --- | --- |
| Single adapter | Computer and PS5 connect to the same router, including over Wi-Fi | The computer's current internet adapter |
| Two adapters | One adapter provides internet access; another connects directly to PS5 by cable | The adapter connected to PS5 |

Click **Configure IP automatically** to add the default service address `192.168.100.1/24`. Existing IP, DHCP, gateway and DNS settings are preserved. If the address or subnet conflicts, choose another private address ending in `.1` and use the matching PS5 settings shown in the app. Automatic configuration supports Windows and macOS and may request system authorization.

Manually enter PS5 IP `192.168.100.2`, mask `255.255.255.0`, primary DNS `192.168.100.1` and gateway `192.168.100.1`, then save the same PS5 address in the app. These parameters provide local access; internet sharing and bridging are not enabled. The router must allow communication between clients. Local use does not require internet access on PS5.

After stopping services and transfers, **Clear app-added configuration** removes the app-added address. Pre-existing addresses are not removed. Closing the app retains the temporary address; restarting the computer expires it, so configure it again afterward. [Configuration, recovery and limitations](guides/usage.en.md#automatic-ip-configuration-and-cleanup)

The computer needs internet access for initial downloads. Cached resources and local files can then be used over the local network; third-party resources may have their own internet dependencies. Automatic configuration has been tested on one Windows computer for actual address addition and cleanup on Ethernet and Wi-Fi while preserving existing internet settings. macOS hardware operation and PS5 connectivity remain unverified.

## Seven steps from setup to playing

The diagram below illustrates the two-adapter direct connection. For single-adapter mode, use the shared-router setup above.

![Direct computer-to-PS5 network setup and seven-step workflow](guides/assets/direct-connect-flow.en.png)

| Step | What to do | Why |
| --- | --- | --- |
| 1. Download and launch | Get the app using the download link above. On Windows, right-click and select “Run as administrator.” On macOS, grant permissions when starting services. | Local DNS and web services need the relevant ports and system permissions. |
| 2. Configure the network and disable automatic updates | undefined Disable automatic system software downloads and installation in the PS5 settings. | Fixed addresses allow direct communication; disabling automatic updates avoids firmware changes that may affect resource compatibility. |
| 3. Download the web repository and start services | “File source” defaults to the [Relapse repository](https://github.com/ntfargo/Relapse-Exploit), with `index.html` as the entry file. Check firmware compatibility, then click “Download and verify” → “Start local services.” You can use another authorized repository or direct HTTPS ZIP URL. Saved sources are retained. | The prefilled URL saves finding and copying the address; downloaded resources let the computer provide local web and DNS services to PS5. |
| 4. Open the PS5 User's Guide for injection | Go to Settings → Guide & Tips, Health & Safety, and Other Information → User's Guide. Follow the selected page's instructions and confirm the injection result on the console. Menu names can vary with language or firmware. | Primary DNS directs the relevant User's Guide domain to the computer. Injection behavior and firmware compatibility depend on the selected repository. |
| 5. Manage and send components from the computer | Confirm the PS5 ELF Loader accepts computer connections. Under “Install components,” download the components you need, click “Load on PS5,” and confirm startup on the console. Cached components can be sent again. | The receiver available after injection accepts components; the required management service must run before game installation. |
| 6. Select and install a local game file | Start PKG Manager on the PS5. Under “Install a local PKG,” choose or drop an authorized `.pkg`, click “Install on PS5,” and keep the computer and file available until installation feedback returns. | The PS5 reads the installation file from the computer and PKG Manager handles installation, without downloading the game on the console. |
| 7. Confirm the result and start playing | Check installation on the PS5 and try launching the game. Confirm that required components are running and the content matches your firmware. | Transfer completion, successful installation, and actual startup are separate states; check the console's result. |

Available components include WebKit Autoloader, PKG Manager, Payload Manager, Kstuff, ShadowMountPlus, FTP Server, and Web File Manager. Choose what you need. [Component details and prerequisites](guides/usage.en.md#components-and-local-pkgs)

For a complete game folder or an `.exfat` / `.ffpkg` image, replace step 6 with “Send game folder / image”:

1. Start an FTP Server that accepts anonymous login on PS5, using port `2121` by default. Send files to `/data/homebrew/`; existing destinations are rejected.
2. Fully close the game on PS5 first. Under “Install components,” select **ShadowMountPlus 1.7beta2 (default)** or **1.7beta3 (optional pre-release)**, click “Download” → “Load on PS5,” and confirm startup on the console. It needs a Kstuff environment matching your firmware; the current Kstuff FPKG test-version combination has not been verified on hardware. Both versions have separate caches; select beta2 to load it again. Beta3 is not a confirmed fix for launch black screens.
3. Check ShadowMountPlus scan and game registration notifications on PS5, then try launching. An already uploaded `PPSA22999.exfat` does not need uploading again just to load the component.

Images are scanned, registered and mounted by the loader; `.pkg` files are installed through PKG Manager. [ShadowMountPlus usage and troubleshooting](guides/usage.en.md#shadowmountplus-image-loading) · [Folder and image transfers](guides/usage.en.md#ftp-transfer-of-game-folders-and-images)

## Launch from YouTube on PS5 later

After the initial jailbreak through another entry point, prepare the YouTube app, account and update blocking required upstream, and start FTP. Under “Install components → Entry and payload management → Y2JB Autoloader,” choose a version and the installed YouTube title ID, download it, fully close YouTube, confirm preparation, then select “Install through FTP.” The app verifies the uploaded file and backs up the previous download data.

After later PS5 restarts, open YouTube to run the exploit and configured payloads without the desktop app; this is not a permanent jailbreak. Without `autoload.txt`, Payload Manager starts, where you still need to configure the payloads to autoload. The latest Relapse build is a pre-release and hardware compatibility is unverified. [Requirements, versions and recovery](guides/usage.en.md#y2jb-autoloader-installation)

## If something goes wrong

| Problem | Check first |
| --- | --- |
| Which IP address should I use? | Choose the mode and adapter. The default added computer service IP is `192.168.100.1`; save `192.168.100.2` as the PS5 address. If you change the subnet, follow the updated values shown in the app. |
| A download fails | Use a repository URL or direct ZIP URL. For slow GitHub downloads, try “GitHub mirror acceleration”; turn it off if it fails. It uses a third-party service. |
| Local services will not start | Read the app's error message and check system permissions and occupied ports. |
| PS5 cannot open the page | Check the direct cable or whether the shared router permits communication between devices. Verify both IP addresses and masks, point PS5 primary DNS to the computer's service IP, and confirm local services are running. |
| A component, PKG, or FTP connection fails | Check the PS5 address and confirm the required Loader, PKG Manager, or FTP Server is running on the console. |
| The result is unconfirmed | Check the actual result on the PS5 before repeating the operation. |

See the [detailed guide](guides/usage.en.md) for further troubleshooting. Developers can find [source setup and builds](guides/usage.en.md#run-from-source) and the [release rules](rules/github-release.md).

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
