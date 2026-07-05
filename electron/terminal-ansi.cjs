function normalizeSgrParameters(paramsText) {
  const params = paramsText === "" ? ["0"] : paramsText.split(";");
  const normalized = [];

  for (let index = 0; index < params.length; index += 1) {
    const param = params[index];
    if (param === "40" || param === "100") {
      normalized.push("49");
      continue;
    }
    if (param === "48" && params[index + 1] === "5" && params[index + 2] === "0") {
      normalized.push("49");
      index += 2;
      continue;
    }
    // 256-color palette: grayscale ramp 232-243 (very dark) → reset to default bg
    // Modern TUIs (Codex v0.142, OpenCode) draw input boxes with palette index
    // 235 instead of basic palette black, so this branch catches what the
    // 40/100/48;5;0/48;2;0;0;0 cases above miss.
    if (
      param === "48" &&
      params[index + 1] === "5" &&
      params[index + 2] !== undefined &&
      /^23[2-9]$|^24[0-3]$/.test(params[index + 2])
    ) {
      normalized.push("49");
      index += 2;
      continue;
    }
    if (
      param === "48" &&
      params[index + 1] === "2" &&
      params[index + 2] === "0" &&
      params[index + 3] === "0" &&
      params[index + 4] === "0"
    ) {
      normalized.push("49");
      index += 4;
      continue;
    }
    normalized.push(param);
  }

  return normalized.join(";");
}

function normalizeTerminalAnsiForDisplay(data) {
  return String(data).replace(/\x1b\[([0-9;]*)m/g, (_match, params) => `\x1b[${normalizeSgrParameters(params)}m`);
}

module.exports = {
  normalizeTerminalAnsiForDisplay
};