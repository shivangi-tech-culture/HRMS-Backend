/**
 * Excel download helper (exceljs)
 * Sets Content-Disposition and streams .xlsx to the response.
 */
const ExcelJS = require("exceljs");

/**
 * @param {import("express").Response} res
 * @param {string} filename - without path, e.g. "access-users.xlsx"
 * @param {{ header: string, key: string, width?: number }[]} columns
 * @param {object[]} rows - plain objects with column keys
 */
const sendExcel = async (res, filename, columns, rows) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "HRMS";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Sheet1", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  sheet.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width || 18,
  }));

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.commit();

  for (const row of rows) {
    sheet.addRow(row);
  }

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filename}"`
  );

  await workbook.xlsx.write(res);
  res.end();
};

module.exports = { sendExcel };
