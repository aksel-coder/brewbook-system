const logoUrl = "/coffee-zone-logo.png";

export async function loadCoffeeZoneLogoDataUrl() {
  const response = await fetch(logoUrl);
  if (!response.ok) throw new Error("The Coffee Zone logo could not be loaded.");
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("The Coffee Zone logo could not be prepared for PDF."));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => reject(new Error("The Coffee Zone logo could not be prepared for PDF."));
    reader.readAsDataURL(blob);
  });
}

export async function printHtmlDocument(title: string, html: string) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", `Print: ${title}`);
  iframe.style.cssText = "position:fixed;left:0;top:0;width:100vw;height:100vh;border:0;visibility:hidden";
  document.body.appendChild(iframe);

  const frameWin = iframe.contentWindow;
  if (!frameWin) {
    iframe.remove();
    throw new Error("Could not prepare the print document.");
  }

  try {
    frameWin.document.open();
    frameWin.document.write(html);
    frameWin.document.close();

    await Promise.all(
      Array.from(frameWin.document.images).map(async (image) => {
        if (!image.complete) {
          await new Promise<void>((resolve, reject) => {
            image.addEventListener("load", () => resolve(), { once: true });
            image.addEventListener("error", () => reject(new Error("A print image could not be loaded.")), { once: true });
          });
        }
        if (typeof image.decode === "function") await image.decode();
        if (image.naturalWidth === 0) throw new Error("A print image could not be loaded.");
      }),
    );

    frameWin.focus();
    frameWin.print();
  } catch (error) {
    console.error("[printHtmlDocument] Could not prepare or print document:", error);
    throw error;
  } finally {
    setTimeout(() => iframe.remove(), 1000);
  }
}

export function printTable(title: string, headers: string[], rows: (string | number)[][]) {
  const logoSrc = new URL(logoUrl, window.location.href).href;
  const head = headers.map(h => `<th>${escapeHtml(h)}</th>`).join("");
  const body = rows.map(r =>
    `<tr>${r.map(c => `<td>${escapeHtml(String(c))}</td>`).join("")}</tr>`,
  ).join("");

  const html = `<!DOCTYPE html><html><head><title>${escapeHtml(title)}</title>
<style>
  body { font-family: system-ui, sans-serif; padding: 24px; color: #111; }
  .document-header { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 20px; }
  .document-heading { min-width: 0; }
  .business-name { font-size: 19px; font-weight: 700; }
  h1 { font-size: 16px; margin: 2px 0 4px; }
  .meta { color: #666; font-size: 12px; margin: 0; }
  .logo { display: block; width: 64px; height: 64px; object-fit: contain; flex: 0 0 auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { border: 1px solid #ccc; padding: 8px 10px; text-align: left; }
  th { background: #6f4e37; color: #fff; }
  tr:nth-child(even) { background: #f9f9f9; }
  @media print {
    @page { margin: 12mm; }
    body { padding: 0; }
    .document-header { break-inside: avoid; }
    th { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  }
</style></head><body>
<header class="document-header">
  <div class="document-heading">
    <div class="business-name">COFFEE ZONE</div>
    <h1>${escapeHtml(title)}</h1>
    <p class="meta">Printed ${escapeHtml(new Date().toLocaleString())}</p>
  </div>
  <img class="logo" src="${escapeHtml(logoSrc)}" alt="Coffee Zone logo" />
</header>
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
</body></html>`;

  void printHtmlDocument(title, html).catch((error) => {
    console.error("[printTable] Could not print document:", error);
  });
}

export function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
