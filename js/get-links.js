"use strict";

const platforms = {
  linux: { name: 'Linux', ext: '.AppImage', },
  mac:   { name: 'MacOS', ext: '.dmg', },
  win:   { name: 'Windows', ext: '.exe', },
};

// Which OS the URL is asking for. Accepts ?os=windows, #os=windows and #windows,
// so the Windows and Linux instructions are reachable from any machine.
const osAliases = {
  mac: 'mac', macos: 'mac', osx: 'mac', darwin: 'mac', apple: 'mac',
  win: 'win', win32: 'win', windows: 'win', pc: 'win',
  linux: 'linux', appimage: 'linux',
};

setupOSTabs();

getLatestReleaseAssets()
  .then(extractPlatformAssets)
  .then((info) => {
    renderLinks(info);
    fillInFilenames(info);
  })
  .catch((e) => {
    console.error(e);
  });

const isMobileRE = /iPod|iPad|iPhone|Android/i;
if (isMobileRE.test(navigator.userAgent)) {
  document.querySelectorAll('video').forEach((video) => {
    const img = new Image();
    img.src = video.src.replace('.mp4', '.gif');
    video.parentElement.appendChild(img);
    video.parentElement.removeChild(video);
  });
}

function getLatestReleaseAssets() {
  return fetch('https://api.github.com/repos/samanthajo2/goon/releases/latest', {
    cache: 'no-cache', // *default, no-cache, reload, force-cache, only-if-cached
    method: 'GET', // *GET, PUT, DELETE, etc.
    mode: 'cors', // no-cors, *same-origin
  }).then((res) => {
    return res.json();
  });
}

function extractPlatformAssets(data) {
  const info = {};
  for (const [platform, platformInfo] of Object.entries(platforms)) {
    for (const asset of data.assets) {
      if (asset.name.endsWith(platformInfo.ext)) {
        info[platform] = asset;
        break;
      }
    }
  }
  return info;
}

function renderLinks(info) {
  const platform = getPlatform();
  const main = info[platform];
  if (main) {
    addButton('#dl-main', platform, main, "main");
  }
  for (const [plat, asset] of Object.entries(info)) {
    // if (asset !== main) {
      addButton('#dl-other', plat, asset);
    // }
  }
}

function addElement(parent, type, content, className) {
  const elem = document.createElement(type);
  elem.textContent = content;
  if (className) {
    elem.className = className;
  }
  parent.appendChild(elem);
}

function addButton(id, platName, asset, extraClass = "") {
  const elem = document.querySelector(id);
  const a = document.createElement('a');
  a.href = asset.browser_download_url;
  addElement(a, 'div', asset.name, 'name');
  addElement(a, 'div', `For ${platforms[platName].name}`, 'plat');
  a.className = `dl-button ${extraClass}`;
  elem.appendChild(a);
}

function getPlatform() {
  const platform = navigator.platform;
  if ((/mac/i).test(platform)) {
    return 'mac';
  } else if ((/win/i).test(platform)) {
    return 'win';
  } else if ((/linux/i).test(platform)) {
    return 'linux';
  }
  return '';
}

// Fills every <* class="fname" data-plat="win"> with the real asset name from the
// latest release, so the instructions never quote a stale version number.
function fillInFilenames(info) {
  for (const elem of document.querySelectorAll('.fname')) {
    const asset = info[elem.dataset.plat];
    if (asset) {
      elem.textContent = asset.name;
    }
  }
}

// "READ THIS!!" section: one tab per OS, defaulting to whatever the visitor is on.
function setupOSTabs() {
  const tabs = [...document.querySelectorAll('.os-tab')];
  const panels = [...document.querySelectorAll('.os-panel')];
  if (!tabs.length) {
    return;
  }

  const select = (os) => {
    for (const tab of tabs) {
      tab.setAttribute('aria-selected', tab.dataset.os === os);
    }
    for (const panel of panels) {
      panel.hidden = panel.dataset.os !== os;
    }
  };

  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      select(tab.dataset.os);
      rememberOSInURL(tab.dataset.os);
    });
  }

  const known = (os) => tabs.some(tab => tab.dataset.os === os);
  const choose = () => {
    const requested = getRequestedOS();
    if (known(requested)) {
      return requested;
    }
    const platform = getPlatform();
    return known(platform) ? platform : 'win';
  };

  select(choose());

  // so ?os=win or #os=win keeps working if you edit the URL without reloading
  window.addEventListener('hashchange', () => {
    const requested = getRequestedOS();
    if (known(requested)) {
      select(requested);
    }
  });
}

function getRequestedOS() {
  const hash = location.hash.slice(1);
  const candidates = [
    new URLSearchParams(location.search).get('os'),
    hash.includes('=') ? new URLSearchParams(hash).get('os') : null,
    hash,
  ];
  for (const candidate of candidates) {
    const os = osAliases[(candidate || '').toLowerCase()];
    if (os) {
      return os;
    }
  }
  return '';
}

// Keep ?os= in sync with the visible tab so the URL is shareable/bookmarkable.
function rememberOSInURL(os) {
  try {
    const url = new URL(location.href);
    url.searchParams.set('os', os);
    history.replaceState(null, '', url);
  } catch (e) {
    // file:// and other odd origins can reject replaceState; the tab still works.
  }
}
