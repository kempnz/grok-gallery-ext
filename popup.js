/* Grok Gallery Manager — Popup */

document.addEventListener("DOMContentLoaded", async () => {
  const onGrokEl = document.getElementById("on-grok");
  const notGrokEl = document.getElementById("not-grok");
  const dlCountEl = document.getElementById("dl-count");
  const toggleBtn = document.getElementById("toggle-btn");

  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_STATUS" });

    if (response.isGrokPage) {
      if (onGrokEl) onGrokEl.style.display = "block";
      if (notGrokEl) notGrokEl.style.display = "none";
      if (dlCountEl) dlCountEl.textContent = response.downloadCount;

      if (toggleBtn) {
        toggleBtn.addEventListener("click", () => {
          chrome.runtime.sendMessage({
            type: "TOGGLE_SIDECAR",
            tabId: response.tabId,
          });
          window.close();
        });
      }
    } else {
      if (onGrokEl) onGrokEl.style.display = "none";
      if (notGrokEl) notGrokEl.style.display = "block";
    }
  } catch (err) {
    if (onGrokEl) onGrokEl.style.display = "none";
    if (notGrokEl) notGrokEl.style.display = "block";
  }
});
