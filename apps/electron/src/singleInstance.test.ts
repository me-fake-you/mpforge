import test from "node:test";
import assert from "node:assert/strict";
import {
  configureSingleInstance,
  type SingleInstanceHost,
  type SingleInstanceWindow,
} from "./singleInstance";

function createWindow(
  calls: string[],
  minimized = false,
): SingleInstanceWindow {
  return {
    isMinimized: () => minimized,
    restore: () => calls.push("restore"),
    show: () => calls.push("show"),
    focus: () => calls.push("focus"),
  };
}

function createHost(
  lock: boolean,
  calls: string[],
  onSecondInstance: (listener: () => void) => void,
): SingleInstanceHost {
  return {
    requestSingleInstanceLock: () => lock,
    quit: () => calls.push("quit"),
    onSecondInstance,
  };
}

test("未取得单实例锁时退出且不注册第二实例处理器", () => {
  const calls: string[] = [];
  let secondInstanceHandler: (() => void) | undefined;
  const host = createHost(false, calls, (listener) => {
    secondInstanceHandler = listener;
  });

  const configured = configureSingleInstance(
    host,
    () => null,
    () => createWindow(calls),
  );

  assert.equal(configured, false);
  assert.deepEqual(calls, ["quit"]);
  assert.equal(secondInstanceHandler, undefined);
});

test("第二实例启动时恢复、显示并聚焦已有窗口", () => {
  const calls: string[] = [];
  let secondInstanceHandler: (() => void) | undefined;
  const window = createWindow(calls, true);
  const host = createHost(true, calls, (listener) => {
    secondInstanceHandler = listener;
  });

  const configured = configureSingleInstance(
    host,
    () => window,
    () => createWindow(calls),
  );

  assert.equal(configured, true);
  secondInstanceHandler?.();
  assert.deepEqual(calls, ["restore", "show", "focus"]);
});

test("第二实例启动时没有窗口则创建并聚焦新窗口", () => {
  const calls: string[] = [];
  let secondInstanceHandler: (() => void) | undefined;
  const host = createHost(true, calls, (listener) => {
    secondInstanceHandler = listener;
  });

  configureSingleInstance(
    host,
    () => null,
    () => createWindow(calls),
  );

  secondInstanceHandler?.();
  assert.deepEqual(calls, ["show", "focus"]);
});
