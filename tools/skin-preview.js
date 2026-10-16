#!/usr/bin/env node
// Pixelize a generated character image and render a pose sheet with it.
// `node tools/skin-preview.js generated.png out.png [skin.json]`
const fs = require('fs')
const { decodePng } = require('./png')
const { loadSprites, render, POSES } = require('./sprite-sheet')
const { pixelize } = require('../renderer/js/pixelize')

const [,, input, out, jsonOut] = process.argv
const skin = pixelize(decodePng(fs.readFileSync(input)))
console.log(JSON.stringify(skin.debug))
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(skin))
const S = loadSprites()
const grids = POSES.map(([, o]) => S.composePet(o, skin))
grids.push(S.composePet({}, { ...skin, glasses: true }), S.composePet({ expr: 'happy', mouth: 'smile' }, { ...skin, glasses: true }))
fs.writeFileSync(out, render(grids, { scale: 8, cols: 5, pad: 2, bg: '#f3efe9' }))
console.log('wrote', out)
