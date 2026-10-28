(() => {
  const id = "extends-ssh-chromium-extension-badge";
  if (document.getElementById(id)) return;

  const badge = document.createElement("div");
  badge.id = id;
  badge.textContent = "1111test221111";
  Object.assign(badge.style, {
    position: "fixed",
    right: "24px",
    bottom: "24px",
    zIndex: "2147483647",
    width: "180px",
    height: "180px",
    display: "grid",
    placeItems: "center",
    borderRadius: "12px",
    color: "#fff",
    background: "#dc2626",
    boxShadow: "0 4px 16px rgba(0, 0, 0, 0.35)",
    font: "700 20px system-ui, sans-serif",
  });
  document.documentElement.appendChild(badge);
})();
