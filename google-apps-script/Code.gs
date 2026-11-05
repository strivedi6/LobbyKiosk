const CONFIG = {
  ADMIN_PIN: '1234',
  SHEET_ID: PropertiesService.getScriptProperties().getProperty('SHEET_ID'),
};

function setup() {
  const sheet = SpreadsheetApp.getActive();
  PropertiesService.getScriptProperties().setProperty('SHEET_ID', sheet.getId());
}

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  try {
    const action = e.parameter.action || e.postData?.getParameter?.('action');

    if (action === 'check') {
      const pin = e.parameter.pin;
      if (pin === CONFIG.ADMIN_PIN) {
        return success({authenticated: true});
      } else {
        return error('Wrong PIN', 'Wrong PIN');
      }
    }

    if (action === 'read') {
      const sheet = getSheet();
      const data = sheet.getDataRange().getValues();
      return success({rows: data});
    }

    if (action === 'write') {
      const sheet = getSheet();
      const data = JSON.parse(e.postData?.contents || e.parameter.data);
      const values = data.rows || [];

      sheet.clearContents();
      if (values.length > 0) {
        sheet.getRange(1, 1, values.length, values[0].length).setValues(values);
      }

      return success({saved: true});
    }

    return error('Unknown action', 'Unknown action');
  } catch (err) {
    return error(err.message, err.stack);
  }
}

function getSheet() {
  const spreadsheet = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  return spreadsheet.getSheetByName('Content') || spreadsheet.getSheets()[0];
}

function success(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function error(msg, details) {
  return ContentService.createTextOutput(JSON.stringify({error: msg, details: details}))
    .setMimeType(ContentService.MimeType.JSON);
}
