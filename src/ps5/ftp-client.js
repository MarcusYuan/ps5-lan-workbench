'use strict';

const net = require('node:net');
const { pipeline } = require('node:stream/promises');
const { validIpv4, validPort } = require('./target');

function fail(code, message) { return Object.assign(new Error(message), { code }); }

// One command at a time. Never expose arbitrary FTP commands through IPC.
class FtpClient {
  constructor(address, port, signal) {
    if (!validIpv4(address) || !validPort(port)) throw fail('INVALID_PS5_PORT', 'Invalid FTP target');
    this.address = address; this.port = port; this.signal = signal;
    this.replies = []; this.pending = null; this.buffer = ''; this.multiline = null;
    this.failure = null;
    this.abort = () => this.close(fail('TASK_CANCELED', 'Transfer canceled'));
  }

  async open() {
    if (this.signal?.aborted) throw fail('TASK_CANCELED', 'Transfer canceled');
    this.socket = net.connect({ host: this.address, port: this.port });
    this.socket.setNoDelay(true);
    this.socket.setEncoding('utf8');
    this.socket.on('error', cause => this.close(cause));
    this.socket.on('close', () => this.close(fail('FTP_CLOSED', 'FTP connection closed')));
    this.socket.on('data', text => this.parse(text));
    this.signal?.addEventListener('abort', this.abort, { once: true });
    let reply = await this.next();
    if (reply.code === 120) reply = await this.next();
    this.expect(reply, [220]);
    reply = await this.command('USER anonymous');
    if (reply.code === 331) reply = await this.command('PASS ps5-local-host');
    this.expect(reply, [230]);
    this.expect(await this.command('TYPE I'), [200]);
  }

  parse(text) {
    this.buffer += text;
    if (this.buffer.length > 65536) return this.close(fail('FTP_PROTOCOL', 'FTP reply too large'));
    let end;
    while ((end = this.buffer.indexOf('\r\n')) >= 0) {
      const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 2);
      if (this.multiline) {
        if (!line.startsWith(`${this.multiline} `)) continue;
        this.multiline = null;
      } else if (/^\d{3}-/.test(line)) { this.multiline = line.slice(0, 3); continue; }
      if (!/^\d{3} /.test(line)) continue;
      const reply = { code: Number(line.slice(0, 3)), text: line.slice(4) };
      if (this.pending) { const pending = this.pending; this.pending = null; pending.resolve(reply); }
      else if (this.replies.length < 16) this.replies.push(reply);
      else this.close(fail('FTP_PROTOCOL', 'Too many FTP replies'));
    }
  }

  next() {
    if (this.failure) return Promise.reject(this.failure);
    if (this.replies.length) return Promise.resolve(this.replies.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.close(fail('FTP_TIMEOUT', 'FTP reply timed out')), 30000);
      this.pending = { resolve: reply => { clearTimeout(timer); resolve(reply); },
        reject: cause => { clearTimeout(timer); reject(cause); } };
    });
  }

  command(command) {
    if (/[\r\n\0]/.test(command)) throw fail('FTP_PROTOCOL', 'Invalid FTP command');
    if (this.failure) return Promise.reject(this.failure);
    this.socket.write(`${command}\r\n`);
    return this.next();
  }

  expect(reply, codes) {
    if (!codes.includes(reply.code)) throw fail('FTP_REPLY', `FTP server returned ${reply.code}`);
    return reply;
  }

  async exists(remote) {
    const size = await this.command(`SIZE ${remote}`);
    if (size.code === 213) return true;
    this.expect(size, [550]);
    const directory = await this.command(`CWD ${remote}`);
    if (directory.code === 250) { this.expect(await this.command('CWD /'), [250]); return true; }
    this.expect(directory, [550]);
    return false;
  }

  async mkdir(remote) {
    const reply = await this.command(`MKD ${remote}`);
    if (reply.code === 257 || reply.code === 250) return;
    this.expect(await this.command(`CWD ${remote}`), [250]);
    this.expect(await this.command('CWD /'), [250]);
  }

  async store(remote, createStream) {
    let reply = await this.command('EPSV');
    let port;
    if (reply.code === 229) {
      const match = reply.text.match(/\((.)(?:\1){2}(\d+)\1\)/);
      port = Number(match?.[2]);
    } else {
      this.expect(reply, [500, 501, 502, 522]);
      reply = this.expect(await this.command('PASV'), [227]);
      const match = reply.text.match(/\((\d+,\d+,\d+,\d+),(\d+),(\d+)\)/);
      if (match && Number(match[2]) <= 255 && Number(match[3]) <= 255)
        port = Number(match[2]) * 256 + Number(match[3]);
    }
    if (!validPort(port)) throw fail('FTP_PROTOCOL', 'Invalid FTP data port');
    // Ignore PASV's advertised host: data must go to the selected PS5 only.
    const data = net.connect({ host: this.address, port });
    this.data = data;
    let stream;
    data.setTimeout(30000, () => data.destroy(fail('FTP_TIMEOUT', 'FTP data timed out')));
    try {
      await new Promise((resolve, reject) => { data.once('connect', resolve); data.once('error', reject); });
      this.expect(await this.command(`STOR ${remote}`), [125, 150]);
      stream = createStream();
      await pipeline(stream, data, { signal: this.signal });
      this.expect(await this.next(), [226, 250]);
    } finally { data.destroy(); this.data = null; stream?.destroy(); }
  }

  async rename(from, to) {
    this.expect(await this.command(`RNFR ${from}`), [350]);
    this.expect(await this.command(`RNTO ${to}`), [250]);
  }

  close(cause = fail('FTP_CLOSED', 'FTP connection closed')) {
    if (!this.failure) this.failure = cause;
    const pending = this.pending; this.pending = null; pending?.reject(this.failure);
    this.signal?.removeEventListener('abort', this.abort);
    this.data?.destroy(this.failure);
    this.socket?.destroy();
  }
}

module.exports = { FtpClient };
