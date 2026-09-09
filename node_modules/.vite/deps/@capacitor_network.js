import { registerPlugin } from "./@capacitor_core.js";
//#region node_modules/@capacitor/network/dist/esm/index.js
var Network = registerPlugin("Network", { web: () => import("./web-AEK0fH6Z.js").then((m) => new m.NetworkWeb()) });
//#endregion
export { Network };
