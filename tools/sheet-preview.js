#!/usr/bin/env node
// Pixelize a generated 3×2 pose sheet and render its frames.
// `node tools/sheet-preview.js sheet.png out.png`
const fs = require('fs')
const { decodePng } = require('./png')
const { render } = require('./sprite-sheet')
const { pixelizeSheet, SHEET_FRAMES } = require('../renderer/js/pixelize')

const [,, input, out] = process.argv
const skin = pixelizeSheet(decodePng(fs.readFileSync(input)))
console.log(JSON.stringify({ w: skin.w, h: skin.h, found: skin.found, ...skin.debug }))
const names = Object.keys(skin.frames)
fs.writeFileSync(out, render(names.map(n => skin.frames[n]), { scale: 3, cols: names.length, pad: 2, bg: '#f3efe9' }))
