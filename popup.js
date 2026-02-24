/* Grok Gallery Manager — Popup */

document.addEventListener("DOMContentLoaded", async () => {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_STATUS" });

    if (response.isGrokPage) {
      document.getElementById("on-grok").style.display = "block";
      document.getElementById("not-grok").style.display = "none";
      document.getElementById("dl-count").textContent = response.downloadCount;

      document.getElementById("toggle-btn").addEventListener("click", () => {
        chrome.runtime.sendMessage({
          type: "TOGGLE_SIDECAR",
          tabId: response.tabId,
        });
        window.close();
      });
    } else {
      document.getElementById("on-grok").style.display = "none";
      document.getElementById("not-grok").style.display = "block";
    }
  } catch (err) {
    document.getElementById("on-grok").style.display = "none";
    document.getElementById("not-grok").style.display = "block";
  }
});
