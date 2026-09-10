(function () {
  const configuredOrigin = window.NativeBridge?.apiOrigin || '';
  const validConfiguredOrigin = /^https?:\/\//i.test(configuredOrigin) && !/YOUR-/i.test(configuredOrigin);
  const serviceOrigin = validConfiguredOrigin ? configuredOrigin.replace(/\/$/, '') : (location.protocol === 'file:' ? 'http://localhost:8787' : '');
  const apiBase = `${serviceOrigin}/api`;
  const databaseName = 'shilpsarathi-offline';

  function unavailableError(originalError) {
    const error = new Error('ShilpSarathi service is unavailable');
    error.code = 'BACKEND_UNAVAILABLE';
    error.cause = originalError;
    return error;
  }

  async function request(path, options = {}, timeoutMs = 190000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const token = path === '/health' ? '' : await window.NativeBridge?.getIdToken?.().catch(() => '');
      const response = await fetch(`${apiBase}${path}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const requestError = Object.assign(new Error(payload.error || `Request failed (${response.status})`), { status: response.status, code: payload.code || 'REQUEST_FAILED' });
        if (response.status === 401) window.dispatchEvent(new CustomEvent('authenticationrequired', { detail: requestError.code }));
        throw requestError;
      }
      return payload;
    } catch (error) {
      if (error.name === 'AbortError' || error instanceof TypeError || /fetch|network|load/i.test(error.message)) {
        throw unavailableError(error);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  async function assetToDataUrl(relativePath) {
    const isAbsolute = /^(?:https?:|blob:|data:)/i.test(relativePath);
    const clean = relativePath.replace(/^\/+/, '');
    const response = await fetch(isAbsolute ? relativePath : `${serviceOrigin}/${clean}`);
    if (!response.ok) throw new Error('Could not load the product photo');
    return blobToDataUrl(await response.blob());
  }

  function openQueue() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('requests', { keyPath: 'id', autoIncrement: true });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function queueListing(payload) {
    const database = await openQueue();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('requests', 'readwrite');
      transaction.objectStore('requests').add({ type: 'generate-listing', payload, createdAt: new Date().toISOString() });
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
    });
  }

  async function flushQueue() {
    const database = await openQueue();
    const entries = await new Promise((resolve, reject) => {
      const transaction = database.transaction('requests', 'readonly');
      const getAll = transaction.objectStore('requests').getAll();
      getAll.onsuccess = () => resolve(getAll.result);
      getAll.onerror = () => reject(getAll.error);
    });
    for (const entry of entries) {
      try {
        await request('/listings/generate', { method: 'POST', body: JSON.stringify(entry.payload) });
        await new Promise((resolve, reject) => {
          const transaction = database.transaction('requests', 'readwrite');
          transaction.objectStore('requests').delete(entry.id);
          transaction.oncomplete = resolve;
          transaction.onerror = () => reject(transaction.error);
        });
      } catch (_) { break; }
    }
    database.close();
  }

  async function generateListing(payload) {
    try {
      return await request('/listings/generate', { method: 'POST', body: JSON.stringify(payload) });
    } catch (error) {
      // Queue only a genuine device-offline case. A stopped local service is a
      // setup problem and must be shown clearly during the evaluator demo.
      if (error.code === 'BACKEND_UNAVAILABLE' && navigator.onLine === false) {
        await queueListing(payload);
        error.queuedOffline = true;
      }
      throw error;
    }
  }

  function addLocalLaunchNotice() {
    if (document.getElementById('backend-launch-notice')) return;
    const notice = document.createElement('aside');
    notice.id = 'backend-launch-notice';
    notice.className = 'backend-launch-notice';
    notice.setAttribute('role', 'alert');

    const copy = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = 'App service is not running';
    const help = document.createElement('span');
    help.textContent = 'Run Start-ShilpSarathi.cmd, then open localhost:8787.';
    copy.append(title, help);

    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Check again';
    retry.addEventListener('click', async () => {
      retry.disabled = true;
      retry.textContent = 'Checking…';
      try {
        await request('/health', {}, 3000);
        location.replace('http://localhost:8787/');
      } catch (_) {
        retry.disabled = false;
        retry.textContent = 'Check again';
      }
    });

    notice.append(copy, retry);
    document.body.append(notice);
  }

  async function guardDirectFileLaunch() {
    if (location.protocol !== 'file:') return;
    try {
      await request('/health', {}, 3000);
      location.replace('http://localhost:8787/');
    } catch (_) {
      addLocalLaunchNotice();
    }
  }

  window.addEventListener('online', () => flushQueue().catch(() => {}));  window.ShilpAPI = {
    serviceOrigin,
    health: (timeoutMs = 3000) => request('/health', {}, timeoutMs),
    getProfile: () => request('/me'),
    updateProfile: changes => request('/me', { method: 'PATCH', body: JSON.stringify(changes) }),
    generateListing,
    suggestPriceFree: (imageDataUrl, description) => request('/ai/suggest-price-free', { method: 'POST', body: JSON.stringify({ imageDataUrl, description }) }),
    listProducts: () => request('/products'),
    updateProduct: (id, changes) => request(`/products/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(changes) }),
    shareProduct: id => request(`/products/${encodeURIComponent(id)}/share`, { method: 'POST', body: '{}' }),
    assetToDataUrl,
    blobToDataUrl,
    flushQueue
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', guardDirectFileLaunch, { once: true });
  } else {
    guardDirectFileLaunch();
  }
})();
