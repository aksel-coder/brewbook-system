export function printTable(title: string, headers: string[], rows: (string | number)[][]) {
  const head = headers.map(h => `<th>${escapeHtml(h)}</th>`).join("");
  const body = rows.map(r =>
    `<tr>${r.map(c => `<td>${escapeHtml(String(c))}</td>`).join("")}</tr>`,
  ).join("");

  const html = `<!DOCTYPE html><html><head><title>${escapeHtml(title)}</title>
<style>
  body { font-family: system-ui, sans-serif; padding: 24px; color: #111; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { color: #666; font-size: 12px; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { border: 1px solid #ccc; padding: 8px 10px; text-align: left; }
  th { background: #6f4e37; color: #fff; }
  tr:nth-child(even) { background: #f9f9f9; }
  @media print { body { padding: 0; } }
</style></head><body>
<h1>Coffee Zone — ${escapeHtml(title)}</h1>
<p class="meta">Printed ${new Date().toLocaleString()}</p>
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
</body></html>`;

  // window.open with "noopener" returns null in modern browsers, leaving a blank tab
  // and never calling print(). A hidden iframe avoids popup blockers and works reliably.
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", `Print: ${title}`);
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(iframe);

  const frameWin = iframe.contentWindow;
  if (!frameWin) {
    document.body.removeChild(iframe);
    console.error("[printTable] Could not access iframe contentWindow");
    return;
  }

  const cleanup = () => {
    setTimeout(() => {
      if (iframe.parentNode) document.body.removeChild(iframe);
    }, 500);
  };

  const triggerPrint = () => {
    try {
      console.log("[printTable] triggering print for:", title, "rows:", rows.length);
      frameWin.focus();
      frameWin.print();
    } catch (err) {
      console.error("[printTable] print() failed:", err);
    } finally {
      cleanup();
    }
  };

  frameWin.document.open();
  frameWin.document.write(html);
  frameWin.document.close();

  if (frameWin.document.readyState === "complete") {
    requestAnimationFrame(triggerPrint);
  } else {
    iframe.onload = () => requestAnimationFrame(triggerPrint);
  }
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
