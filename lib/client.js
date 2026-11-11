window.__ModuleLoader__.load({
  id: "dsh-douyin",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src-client/index.js
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);
var React = __toESM(require("react"), 1);
var name = "dsh-douyin-client";
var inject = ["slots", "connection"];
var h = React.createElement;
var LOCAL_VERSION = true ? "0.3.2" : "0.0.0";
function apply(ctx) {
  const connection = ctx.connection;
  function UpdatePanel() {
    const [state, setState] = React.useState({ phase: "idle", message: "" });
    const checkAndUpdate = React.useCallback(async () => {
      setState({ phase: "running", message: "\u6B63\u5728\u68C0\u67E5 GitHub \u4E0A\u7684\u6700\u65B0\u7248\u672C\u2026" });
      const controller = new AbortController();
      try {
        const result = await connection.rpc.call(
          "/api",
          "dsh-douyin/update",
          { method: "update.run", payload: { apply: true } },
          controller.signal
        );
        if (!result || result.ok !== true) {
          throw new Error(result?.error?.message || "\u66F4\u65B0\u8BF7\u6C42\u5931\u8D25");
        }
        const value = result.value ?? {};
        if (value.status === "updated") {
          setState({
            phase: "done",
            message: `\u5DF2\u66F4\u65B0 v${value.currentVersion} \u2192 v${value.latestVersion}\uFF0C\u8BF7\u91CD\u542F dsh \u751F\u6548\u3002`
          });
        } else if (value.status === "update-available") {
          setState({ phase: "done", message: `\u53D1\u73B0\u65B0\u7248\u672C v${value.latestVersion}\uFF0C\u518D\u6B21\u70B9\u51FB\u53EF\u66F4\u65B0\u3002` });
        } else {
          setState({ phase: "done", message: `\u5DF2\u662F\u6700\u65B0\u7248\u672C v${value.currentVersion}\u3002` });
        }
      } catch (error) {
        setState({ phase: "error", message: `\u68C0\u67E5\u5931\u8D25\uFF1A${error?.message ?? error}` });
      }
    }, []);
    const running = state.phase === "running";
    return h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          padding: "4px 2px",
          fontSize: "13px",
          lineHeight: 1.6
        }
      },
      h("div", { style: { fontSize: "15px", fontWeight: 600 } }, "\u6296\u97F3\u6536\u85CF\u63D2\u4EF6"),
      h("div", null, `\u5F53\u524D\u7248\u672C\uFF1Av${LOCAL_VERSION}`),
      h(
        "div",
        { style: { opacity: 0.72 } },
        "\u70B9\u51FB\u6309\u94AE\u4F1A\u68C0\u67E5 GitHub \u4ED3\u5E93\uFF0C\u6709\u65B0\u7248\u672C\u65F6\u81EA\u52A8\u4E0B\u8F7D\u5E76\u66FF\u6362\u63D2\u4EF6\u6587\u4EF6\uFF1B\u91CD\u542F dsh \u540E\u751F\u6548\u3002"
      ),
      h("button", {
        type: "button",
        onClick: checkAndUpdate,
        disabled: running,
        style: {
          alignSelf: "flex-start",
          padding: "6px 16px",
          borderRadius: "8px",
          border: "1px solid currentColor",
          background: "transparent",
          color: "inherit",
          cursor: running ? "default" : "pointer",
          opacity: running ? 0.6 : 1,
          font: "inherit"
        }
      }, running ? "\u6B63\u5728\u68C0\u67E5\u2026" : "\u68C0\u67E5\u66F4\u65B0"),
      state.message ? h("div", { style: { opacity: 0.85, whiteSpace: "pre-wrap" } }, state.message) : null
    );
  }
  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: "dsh-douyin",
    order: 56,
    label: () => "\u6296\u97F3\u6536\u85CF"
  }, UpdatePanel));
}

    return module.exports;
  }
});
