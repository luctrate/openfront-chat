const api = typeof browser !== "undefined" ? browser : chrome;
document.getElementById("ver").textContent = api.runtime.getManifest().version;
