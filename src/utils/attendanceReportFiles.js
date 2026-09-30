/**
 * Write Excel / PDF report files under uploads/reports
 */
const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");

const reportsDir = () => {
  const dir = path.join(process.cwd(), "uploads", "reports");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const safeName = (s) =>
  String(s || "report")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 80);

/**
 * @returns {Promise<{ fileName: string, filePath: string }>}
 */
const writeExcelReport = async (baseName, title, columns, rows) => {
  const fileName = `${safeName(baseName)}.xlsx`;
  const filePath = path.join(reportsDir(), fileName);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "HRMS";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(title.slice(0, 28) || "Report", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width || 16,
  }));
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) sheet.addRow(row);
  await workbook.xlsx.writeFile(filePath);
  return { fileName, filePath };
};

/**
 * Simple table PDF
 * @returns {Promise<{ fileName: string, filePath: string }>}
 */
const writePdfReport = (baseName, title, columns, rows, meta = {}) => {
  return new Promise((resolve, reject) => {
    try {
      const fileName = `${safeName(baseName)}.pdf`;
      const filePath = path.join(reportsDir(), fileName);
      const doc = new PDFDocument({ margin: 40, size: "A4", layout: "landscape" });
      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      doc.fontSize(16).text(title, { align: "left" });
      doc.moveDown(0.3);
      doc
        .fontSize(9)
        .fillColor("#555")
        .text(
          [
            meta.company ? `Company: ${meta.company}` : null,
            meta.from && meta.to ? `Period: ${meta.from} → ${meta.to}` : null,
            `Generated: ${new Date().toLocaleString("en-IN")}`,
            `Rows: ${rows.length}`,
          ]
            .filter(Boolean)
            .join("  |  ")
        );
      doc.moveDown(0.8);
      doc.fillColor("#000");

      const headers = columns.map((c) => c.header);
      const keys = columns.map((c) => c.key);
      const startX = 40;
      let y = doc.y;
      const pageWidth = doc.page.width - 80;
      const colW = Math.max(50, Math.floor(pageWidth / Math.max(headers.length, 1)));

      const drawHeader = () => {
        doc.fontSize(8).font("Helvetica-Bold");
        headers.forEach((h, i) => {
          doc.text(String(h), startX + i * colW, y, {
            width: colW - 4,
            ellipsis: true,
          });
        });
        y += 16;
        doc
          .moveTo(startX, y - 4)
          .lineTo(startX + pageWidth, y - 4)
          .stroke("#ccc");
        doc.font("Helvetica");
      };

      drawHeader();

      for (const row of rows) {
        if (y > doc.page.height - 50) {
          doc.addPage();
          y = 40;
          drawHeader();
        }
        keys.forEach((k, i) => {
          const val = row[k] == null ? "" : String(row[k]);
          doc.text(val, startX + i * colW, y, {
            width: colW - 4,
            ellipsis: true,
          });
        });
        y += 14;
      }

      doc.end();
      stream.on("finish", () => resolve({ fileName, filePath }));
      stream.on("error", reject);
    } catch (err) {
      reject(err);
    }
  });
};

module.exports = {
  reportsDir,
  writeExcelReport,
  writePdfReport,
};
