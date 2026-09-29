'use strict';

const { createError } = require('../i18n');
const MIRROR_ORIGIN = 'https://gh-proxy.org';
const GITHUB_HOSTS = new Set(['github.com', 'api.github.com', 'codeload.github.com',
  'raw.githubusercontent.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);

function isPublicGithubUrl(url) {
  return url.protocol === 'https:' && !url.port && !url.username && !url.password &&
    !url.search && GITHUB_HOSTS.has(url.hostname);
}

function downloadUrl(value, mode = 'direct') {
  const url = new URL(value);
  // Never send arbitrary hosts, credentials, or signed/query URLs to the mirror.
  return mode === 'mirror' && isPublicGithubUrl(url) ? `${MIRROR_ORIGIN}/${url.href}` : value;
}

function allowedMirrorRedirect(value) {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.port && !url.username && !url.password &&
    (url.origin === MIRROR_ORIGIN || GITHUB_HOSTS.has(url.hostname));
}

// Capture the route per task: changing the preference never redirects an active download.
function createDownloadFetch(mode = 'direct', fetchImpl = globalThis.fetch) {
  return async (value, options = {}) => {
    let url = downloadUrl(value, mode);
    if (url === value) return fetchImpl(value, options);
    const headers = new Headers(options.headers);
    for (const name of ['authorization', 'cookie', 'proxy-authorization']) headers.delete(name);
    try {
      for (let redirects = 0; redirects <= 5; redirects++) {
        const response = await fetchImpl(url, { ...options, headers, redirect: 'manual', credentials: 'omit' });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          await response.body?.cancel();
          if (!location || redirects === 5) throw new Error('Invalid or excessive mirror redirects');
          url = new URL(location, url).href;
          if (!allowedMirrorRedirect(url)) throw new Error('Unexpected mirror redirect');
          continue;
        }
        if (!allowedMirrorRedirect(response.url || url) || !response.ok) {
          await response.body?.cancel();
          throw new Error(`Mirror request failed (${response.status})`);
        }
        return response;
      }
    } catch (cause) {
      if (options.signal?.aborted || cause.name === 'AbortError') throw cause;
      throw createError('MIRROR_DOWNLOAD_FAILED', 'downloadRoute.failed', {}, cause.message);
    }
  };
}

module.exports = { MIRROR_ORIGIN, downloadUrl, createDownloadFetch };
