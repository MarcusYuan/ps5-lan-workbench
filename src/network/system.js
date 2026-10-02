'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createError } = require('../i18n');
const runFile = promisify(execFile);
const fail = detail => createError('NETWORK_SYSTEM', 'network.systemError', {}, detail);
const windowsRead = `
$ErrorActionPreference='Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$adapters = @(Get-NetAdapter)
$ips = @(Get-NetIPAddress -AddressFamily IPv4)
$interfaces = @(Get-NetIPInterface -AddressFamily IPv4)
$dns = @(Get-DnsClientServerAddress -AddressFamily IPv4)
$routes = @(Get-NetRoute -AddressFamily IPv4 -PolicyStore ActiveStore)
$coexist = @(& netsh.exe interface ipv4 show interfaces level=verbose)
$result = @($adapters | ForEach-Object {
  $a=$_; $i=$interfaces | Where-Object InterfaceIndex -eq $a.ifIndex | Select-Object -First 1
  [pscustomobject]@{id=$a.InterfaceGuid.ToString(); index=[int]$a.ifIndex; name=$a.Name; hardware=[bool]$a.HardwareInterface;
    connected=($a.Status -eq 'Up'); dhcp=($i.Dhcp -eq 'Enabled');
    addresses=@($ips | Where-Object InterfaceIndex -eq $a.ifIndex | ForEach-Object {
      [pscustomobject]@{address=$_.IPAddress; prefix=[int]$_.PrefixLength; origin=$_.PrefixOrigin.ToString();
        state=$_.AddressState.ToString(); skipAsSource=[bool]$_.SkipAsSource}});
    gateways=@($routes | Where-Object { $_.InterfaceIndex -eq $a.ifIndex -and $_.DestinationPrefix -eq '0.0.0.0/0' } | ForEach-Object NextHop);
    dns=@($dns | Where-Object InterfaceIndex -eq $a.ifIndex | ForEach-Object ServerAddresses)
  }
})
[pscustomobject]@{bootId=(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o'); adapters=$result;
  defaults=@($routes | Where-Object DestinationPrefix -eq '0.0.0.0/0' | ForEach-Object { "$($_.InterfaceIndex):$($_.NextHop):$($_.RouteMetric)" });
  routes=@($routes | ForEach-Object { [pscustomobject]@{index=[int]$_.InterfaceIndex; destination=$_.DestinationPrefix} });
  coexistence=($coexist -join "\n"); dnsState=''} | ConvertTo-Json -Depth 6 -Compress
`;

function parseCoexistence(text) {
  const values = new Map();
  let index;
  for (const line of text.split(/\r?\n/)) {
    const found = line.match(/^\s*(?:IfIndex|接口索引)\s*:\s*(\d+)/i);
    if (found) index = Number(found[1]);
    const setting = line.match(/^\s*DHCP.*(?:coexistence|共存)\s*:\s*(enabled|disabled|启用|禁用)\s*$/i);
    if (setting && index) values.set(index, /^(enabled|启用)$/i.test(setting[1]));
  }
  return values;
}

function parseMacInterfaces(text, hardwareText) {
  const hardware = new Map();
  for (const part of hardwareText.split(/Hardware Port: /).slice(1)) {
    const name = part.match(/^([^\r\n]+)/)?.[1];
    const device = part.match(/Device: (\w+)/)?.[1];
    if (device) hardware.set(device, name);
  }
  return text.split(/\n(?=\w[^\s:]*: flags=)/).flatMap(block => {
    const device = block.match(/^([\w]+): flags=/)?.[1];
    if (!device) return [];
    const mac = block.match(/\bether ([a-f\d:]+)/i)?.[1] || '';
    const addresses = [...block.matchAll(/\binet (\d+\.\d+\.\d+\.\d+) netmask (0x[a-f\d]+)/gi)].map(m => ({
      address: m[1], prefix: parseInt(m[2], 16).toString(2).replace(/0/g, '').length,
      origin: 'Manual', state: 'Preferred', skipAsSource: false,
    }));
    return [{ id: `${device}:${mac}`, device, name: hardware.get(device) || device, hardware: hardware.has(device) && /^en\d+$/.test(device),
      connected: /status: active/.test(block), addresses, dhcp: false, gateways: [], dns: [], coexistence: null }];
  });
}

function createSystemDriver({ platform = process.platform, exec = runFile } = {}) {
  const run = async (file, args) => {
    try { return (await exec(file, args, { windowsHide: true, timeout: 20000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' })).stdout; }
    catch (cause) { throw fail(cause.stderr || cause.message); }
  };
  const powershell = script => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]);
  function identity(adapter) {
    if (platform === 'win32') {
      if (!Number.isInteger(adapter.index) || adapter.index < 1 || !/^\{?[\da-f-]{36}\}?$/i.test(adapter.id)) throw fail('Invalid adapter identity');
      return String(adapter.index);
    }
    if (!/^en\d+$/.test(adapter.device)) throw fail('Unsupported network device');
    return adapter.device;
  }
  function address(ip) { if (!/^\d{1,3}(\.\d{1,3}){2}\.1$/.test(ip)) throw fail('Invalid service address'); return ip; }
  return {
    async read() {
      if (platform === 'win32') {
        const raw = JSON.parse((await powershell(windowsRead)).trim().replace(/^\uFEFF/, ''));
        const coexistence = parseCoexistence(raw.coexistence);
        const adapters = raw.adapters.map(a => ({ ...a, id: a.id.toLowerCase(), coexistence: coexistence.get(a.index) ?? null }));
        return { platform, bootId: raw.bootId, adapters, defaults: raw.defaults, dnsState: raw.dnsState,
          routes: raw.routes.map(r => { const [ip, prefix] = r.destination.split('/'); return { adapterId: adapters.find(a => a.index === r.index)?.id, address: ip, prefix: Number(prefix) }; }) };
      }
      if (platform === 'darwin') {
        const [interfaces, hardware, bootId, routing, dnsState] = await Promise.all([
          run('/sbin/ifconfig', ['-a']), run('/usr/sbin/networksetup', ['-listallhardwareports']),
          run('/usr/sbin/sysctl', ['-n', 'kern.boottime']), run('/usr/sbin/netstat', ['-rn', '-f', 'inet']), run('/usr/sbin/scutil', ['--dns']),
        ]);
        const adapters = parseMacInterfaces(interfaces, hardware);
        const defaults = routing.split('\n').filter(line => /^default\s/.test(line)).map(line => line.trim().replace(/\s+/g, ' '));
        for (const a of adapters) {
          a.gateways = defaults.filter(line => line.split(' ').includes(a.device)).map(line => line.split(' ')[1]);
          if (a.hardware) {
            const packet = await run('/usr/sbin/ipconfig', ['getpacket', a.device]).catch(() => '');
            a.dhcp = /yiaddr\s*=/.test(packet);
          }
        }
        return { platform, bootId: bootId.trim(), adapters, defaults, routes: [],
          dnsState: dnsState.split('\n').filter(line => /nameserver\[|domain\s*:|search domain\[/.test(line)).map(line => line.trim()).sort().join('\n') };
      }
      throw createError('NETWORK_UNSUPPORTED', 'network.unsupported');
    },
    async coexist(adapter, enabled) {
      if (platform !== 'win32') throw fail('Unsupported coexistence command');
      await run('netsh.exe', ['interface', 'ipv4', 'set', 'interface', `interface=${identity(adapter)}`,
        `dhcpstaticipcoexistence=${enabled ? 'enabled' : 'disabled'}`, 'store=active']);
    },
    async add(adapter, ip) {
      const name = identity(adapter); address(ip);
      if (platform === 'win32') await run('netsh.exe', ['interface', 'ipv4', 'add', 'address', `name=${name}`,
        `address=${ip}`, 'mask=255.255.255.0', 'store=active',
        // An otherwise unaddressed direct-connect NIC needs this IP as an outbound source.
        `skipassource=${adapter.addresses.some(a => !a.address.startsWith('169.254.'))}`]);
      else if (platform === 'darwin') await run('/sbin/ifconfig', [name, 'inet', ip, 'netmask', '255.255.255.0', 'alias']);
      else throw fail('Unsupported platform');
    },
    async remove(adapter, ip) {
      const name = identity(adapter); address(ip);
      if (platform === 'win32') await run('netsh.exe', ['interface', 'ipv4', 'delete', 'address', `name=${name}`, `address=${ip}`, 'store=active']);
      else if (platform === 'darwin') await run('/sbin/ifconfig', [name, 'inet', ip, '-alias']);
      else throw fail('Unsupported platform');
    },
    wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
  };
}

module.exports = { createSystemDriver, parseCoexistence, parseMacInterfaces };
