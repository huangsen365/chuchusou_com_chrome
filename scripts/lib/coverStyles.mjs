/**
 * 封面风格：一个风格一个文件，构建时组装成运行时读取的 prompts/coverPrompts.json。
 *
 *   prompts/cover/index.json   templateFile（相对 prompts/）、默认 engines、order（显示顺序）
 *   prompts/cover/<id>.json    id / label / icon / purpose，可选 credit / palettes / engines
 *
 * 组装结果与拆分前的 coverPrompts.json 结构相同（每个 category 多一个 icon 字段），
 * 所以 SW / popup / sidepanel 的读取代码不用改。缺文件、多文件、id 与文件名不符都直接报错。
 */

import fs from "node:fs"
import path from "node:path"

export const COVER_STYLE_DIR = "prompts/cover"
export const COVER_OUTPUT = "prompts/coverPrompts.json"

function readJson(abs) {
  return JSON.parse(fs.readFileSync(abs, "utf8"))
}

export function assembleCoverPrompts(root) {
  const dir = path.join(root, COVER_STYLE_DIR)
  const index = readJson(path.join(dir, "index.json"))
  const order = Array.isArray(index.order) ? index.order : []
  if (order.length === 0) throw new Error(`${COVER_STYLE_DIR}/index.json 的 order 为空`)
  if (new Set(order).size !== order.length) throw new Error(`${COVER_STYLE_DIR}/index.json 的 order 有重复 id`)

  const styleFiles = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "index.json")
  const orphans = styleFiles.map((f) => f.slice(0, -".json".length)).filter((id) => !order.includes(id))
  if (orphans.length) {
    throw new Error(`${COVER_STYLE_DIR}/ 里有没列进 index.json order 的风格文件: ${orphans.join(", ")}`)
  }

  const categories = order.map((id) => {
    const file = path.join(dir, `${id}.json`)
    if (!fs.existsSync(file)) throw new Error(`index.json order 里的 ${id} 缺文件 ${COVER_STYLE_DIR}/${id}.json`)
    const style = readJson(file)
    if (style.id !== id) throw new Error(`${COVER_STYLE_DIR}/${id}.json 的 id 是 "${style.id}"，必须与文件名一致`)
    const { engines, ...rest } = style
    const category = { id, label: rest.label, icon: rest.icon }
    if (rest.credit) category.credit = rest.credit
    category.purpose = rest.purpose
    category.engines = Array.isArray(engines) ? engines : index.engines
    if (rest.palettes) category.palettes = rest.palettes
    const extra = Object.keys(rest).filter((k) => !["id", "label", "icon", "credit", "purpose", "palettes"].includes(k))
    if (extra.length) throw new Error(`${COVER_STYLE_DIR}/${id}.json 有未知字段: ${extra.join(", ")}`)
    return category
  })

  return { _comment: index._comment, templateFile: index.templateFile, categories }
}

export function writeAssembledCoverPrompts(root, targetDir) {
  const config = assembleCoverPrompts(root)
  const out = path.join(targetDir, COVER_OUTPUT)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, `${JSON.stringify(config, null, 2)}\n`)
  return { out, count: config.categories.length }
}
