import { WebPlugin } from "./@capacitor_core.js";
//#region node_modules/@capacitor/network/dist/esm/web.js
function translatedConnection() {
	const connection = window.navigator.connection || window.navigator.mozConnection || window.navigator.webkitConnection;
	let result = "unknown";
	const type = connection ? connection.type || connection.effectiveType : null;
	if (type && typeof type === "string") switch (type) {
		case "bluetooth":
		case "cellular":
			result = "cellular";
			break;
		case "none":
			result = "none";
			break;
		case "ethernet":
		case "wifi":
		case "wimax":
			result = "wifi";
			break;
		case "other":
		case "unknown":
			result = "unknown";
			break;
		case "slow-2g":
		case "2g":
		case "3g":
			result = "cellular";
			break;
		case "4g": result = "wifi";
	}
	return result;
}
var NetworkWeb = class extends WebPlugin {
	constructor() {
		super();
		this.handleOnline = () => {
			const status = {
				connected: true,
				connectionType: translatedConnection()
			};
			this.notifyListeners("networkStatusChange", status);
		};
		this.handleOffline = () => {
			this.notifyListeners("networkStatusChange", {
				connected: false,
				connectionType: "none"
			});
		};
		if (typeof window !== "undefined") {
			window.addEventListener("online", this.handleOnline);
			window.addEventListener("offline", this.handleOffline);
		}
	}
	async getStatus() {
		if (!window.navigator) throw this.unavailable("Browser does not support the Network Information API");
		const connected = window.navigator.onLine;
		const connectionType = translatedConnection();
		return {
			connected,
			connectionType: connected ? connectionType : "none"
		};
	}
};
new NetworkWeb();
//#endregion
export { NetworkWeb };
