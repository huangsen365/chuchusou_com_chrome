/**
 * SW 事件层源码（background/events.js 接线 + background/events/*.js handler），
 * 供守卫脚本做源码级断言。
 */

import fs from "node:fs"
import path from "node:path"

export function readEventSources(root) {
  const dir = path.join(root, "background/events")
  const files = ["background/events.js", ...fs.readdirSync(dir).filter((f) => f.endsWith(".js")).sort().map((f) => `background/events/${f}`)]
  return files.map((rel) => fs.readFileSync(path.join(root, rel), "utf8")).join("\n")
}

// ccsRegisterMessageHandlers({ action: handler, 'dash-action': handler }) 登记的全部 action
export function registeredMessageActions(root) {
  const source = readEventSources(root)
  const actions = []
  for (const block of source.matchAll(/ccsRegisterMessageHandlers\(\{([\s\S]*?)\}\);/g)) {
    for (const m of block[1].matchAll(/^\s*'?([\w-]+)'?\s*:/gm)) actions.push(m[1])
  }
  return actions
}
