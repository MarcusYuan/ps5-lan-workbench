# PS5 Local Host

[简体中文](README.md) | [English](README.en.md)

Connect your computer directly to your PS5 with an Ethernet cable to host local injection pages, manage and send components, and install local game files. The computer uses Wi-Fi to download resources and a separate Ethernet interface for the PS5. No router is needed between the computer and console.

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

Connect the computer's Wi-Fi interface to your usual Wi-Fi network. **Connect its Ethernet interface directly to the PS5 with a cable.** Configure the wired link manually:

| Setting | Computer Ethernet interface | PS5 wired network |
| --- | --- | --- |
| IPv4 address | `192.168.100.1` | `192.168.100.2` |
| Subnet mask | `255.255.255.0` | `255.255.255.0` |
| Default gateway | Leave blank; Wi-Fi continues to provide internet access | `192.168.100.1` |
| Primary DNS | Leave blank; keep existing Wi-Fi settings | `192.168.100.1` |

In the app, select the **Ethernet interface at `192.168.100.1`** and save **`192.168.100.2` as the PS5 address**. The first hosts web pages; the second receives components and game files. Setting a gateway does not automatically enable internet sharing on the computer. Keep network bridging and internet sharing disabled for this setup.

**Local use does not require internet access on the PS5.** The computer needs internet access to initially download the app, web repository, and components. Once downloaded, local hosting, cached component delivery, and local file installation use the cable. Any internet requirement of the web page or third-party component depends on the selected resource.

## Seven steps from setup to playing

<details>
<summary>View the direct connection setup and seven-step diagram</summary>

![Direct computer-to-PS5 network setup and seven-step workflow](guides/assets/direct-connect-flow.en.png)

</details>

| Step | What to do | Why |
| --- | --- | --- |
| 1. Download and launch | Get the app using the download link above. On Windows, right-click and select “Run as administrator.” On macOS, grant permissions when starting services. | Local DNS and web services need the relevant ports and system permissions. |
| 2. Configure the network and disable automatic updates | Apply the wired IP settings above, select the Ethernet interface in the app, and save the PS5 address. Disable automatic system software downloads and installation in the PS5 settings. | Fixed addresses allow direct communication; disabling automatic updates avoids firmware changes that may affect resource compatibility. |
| 3. Download the web repository and start services | Under “File source,” enter a repository or direct HTTPS ZIP URL that matches your firmware and that you are authorized to use. Click “Download and verify” → “Start local services.” The entry file is usually `index.html`. | Store the injection web resources on the computer, then provide local web and DNS services to the PS5. |
| 4. Open the PS5 User's Guide for injection | Go to Settings → Guide & Tips, Health & Safety, and Other Information → User's Guide. Follow the selected page's instructions and confirm the injection result on the console. Menu names can vary with language or firmware. | Primary DNS directs the relevant User's Guide domain to the computer. Injection behavior and firmware compatibility depend on the selected repository. |
| 5. Manage and send components from the computer | Confirm the PS5 ELF Loader accepts computer connections. Under “Install components,” download the components you need, click “Load on PS5,” and confirm startup on the console. Cached components can be sent again. | The receiver available after injection accepts components; the required management service must run before game installation. |
| 6. Select and install a local game file | Start PKG Manager on the PS5. Under “Install a local PKG,” choose or drop an authorized `.pkg`, click “Install on PS5,” and keep the computer and file available until installation feedback returns. | The PS5 reads the installation file from the computer and PKG Manager handles installation, without downloading the game on the console. |
| 7. Confirm the result and start playing | Check installation on the PS5 and try launching the game. Confirm that required components are running and the content matches your firmware. | Transfer completion, successful installation, and actual startup are separate states; check the console's result. |

Available components include WebKit Autoloader, PKG Manager, Payload Manager, Kstuff, ShadowMountPlus, FTP Server, and Web File Manager. Choose what you need. [Component details and prerequisites](guides/usage.en.md#components-and-local-pkgs)

For a complete game folder or an `.exfat` / `.ffpkg` image, replace step 6 with “Send game folder / image”:

1. Start an FTP Server that accepts anonymous login on PS5, using port `2121` by default. Send files to `/data/homebrew/`; existing destinations are rejected.
2. Under “Install components,” download **ShadowMountPlus 1.7beta2**, click “Load on PS5,” and confirm startup on the console. It needs a Kstuff environment matching your firmware; the current Kstuff FPKG test-version combination has not been verified on hardware.
3. Check ShadowMountPlus scan and game registration notifications on PS5, then try launching. An already uploaded `PPSA22999.exfat` does not need uploading again just to load the component.

Images are scanned, registered and mounted by the loader; `.pkg` files are installed through PKG Manager. [ShadowMountPlus usage and troubleshooting](guides/usage.en.md#shadowmountplus-image-loading) · [Folder and image transfers](guides/usage.en.md#ftp-transfer-of-game-folders-and-images)

## If something goes wrong

| Problem | Check first |
| --- | --- |
| Which IP address should I use? | Select the computer Ethernet interface at `192.168.100.1`; save `192.168.100.2` as the PS5 address. |
| A download fails | Use a repository URL or direct ZIP URL. For slow GitHub downloads, try “GitHub mirror acceleration”; turn it off if it fails. It uses a third-party service. |
| Local services will not start | Read the app's error message and check system permissions and occupied ports. |
| PS5 cannot open the page | Check the direct Ethernet cable, both IP addresses and subnet masks, PS5 primary DNS `192.168.100.1`, and whether services are running on the Ethernet interface. |
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
