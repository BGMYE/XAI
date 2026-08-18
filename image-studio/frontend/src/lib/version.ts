const packageVersion = import.meta.env.PACKAGE_VERSION ?? "0.0.0";
const buildVersion = import.meta.env.VITE_APP_VERSION?.trim();

export const appVersion = buildVersion && buildVersion.length > 0 ? buildVersion : packageVersion;
