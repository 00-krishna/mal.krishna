// renderer.js
const { ipcRenderer } = require("electron");

document.getElementById("deleteBtn").addEventListener("click", async () => {
  const result = await ipcRenderer.invoke("delete-screenshots");
  document.getElementById("status").innerText = result.message;
});
