#!/usr/bin/env node
/**
 * rubric-freeze.js
 *
 * Node-based helper for gate-2 rubric sealing.
 *
 * Limitation (honest): this detects drift by byte-level hash only (sha256 of the
 * spec file bytes). It does not analyze whether review findings semantically match
 * the rubric; it only detects text/spec content changes.
 */

'use strict'

const fs = require('fs')
const crypto = require('crypto')

const usage = `Usage:
  node scripts/rubric-freeze.js seal <spec-file> [--out <seal-file>] [--json]
  node scripts/rubric-freeze.js check <spec-file> <seal-file> [--json]
  node scripts/rubric-freeze.js -h | --help`

const argv = process.argv.slice(2)

if (argv.length === 0) {
  console.error('rubric-freeze: missing command')
  printUsage()
  process.exit(2)
}

if (argv[0] === '-h' || argv[0] === '--help') {
  printUsage()
  process.exit(0)
}

const command = argv[0]
const commandArgs = argv.slice(1)

if (command === 'seal') {
  runSeal(commandArgs)
} else if (command === 'check') {
  runCheck(commandArgs)
} else {
  unknown(`unknown subcommand: ${command}`)
}

function runSeal(args) {
  if (args.length === 0) {
    unknown('missing spec-file')
  }

  const options = parseOptions(args)
  if (options.positional.length !== 1) {
    unknown('usage: seal expects one spec-file argument')
  }

  const specPath = options.positional[0]

  const digest = sha256(specPath)
  const seal = {
    spec_sha256: digest,
    spec_path: specPath,
    sealed_at: new Date().toISOString(),
  }

  const out = JSON.stringify(seal, null, 2)
  if (options.out) {
    try {
      fs.writeFileSync(options.out, out)
    } catch (err) {
      fail(err.message, 2)
    }
  } else {
    process.stdout.write(out + '\n')
  }
  process.exit(0)
}

function runCheck(args) {
  const options = parseOptions(args)
  if (options.positional.length !== 2) {
    unknown('usage: check expects spec-file and seal-file')
  }

  const specPath = options.positional[0]
  const sealPath = options.positional[1]

  const specDigest = sha256(specPath)
  const sealed = loadSeal(sealPath)
  const sealedDigest = sealed.spec_sha256

  const result = {
    verdict: specDigest === sealedDigest ? 'FROZEN' : 'DRIFT',
    spec_sha256: specDigest,
    sealed_sha256: sealedDigest,
    spec_path: specPath,
    seal_path: sealPath,
  }

  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  process.exit(result.verdict === 'FROZEN' ? 0 : 3)
}

function loadSeal(sealPath) {
  let raw
  try {
    raw = fs.readFileSync(sealPath, 'utf8')
  } catch (err) {
    fail(`unable to read seal file: ${sealPath}`, 2)
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    fail('seal file is not valid JSON', 2)
  }

  const digest = parsed && parsed.spec_sha256
  if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) {
    fail('seal file missing valid spec_sha256', 2)
  }

  return parsed
}

function parseOptions(args) {
  const options = { positional: [], hasJson: false }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--json') {
      options.hasJson = true
      continue
    }

    if (arg === '--out') {
      if (i === args.length - 1) {
        unknown('missing value for --out')
      }
      options.out = args[++i]
      continue
    }

    if (arg.startsWith('-')) {
      unknown(`unknown flag: ${arg}`)
    }

    options.positional.push(arg)
  }

  return options
}

function sha256(filePath) {
  let data
  try {
    data = fs.readFileSync(filePath)
  } catch (err) {
    fail(`unable to read spec file: ${filePath}`, 2)
  }
  return crypto.createHash('sha256').update(data).digest('hex')
}

function printUsage() {
  console.log(usage)
}

function fail(message, code) {
  console.error(`rubric-freeze: ${message}`)
  process.exit(code)
}

function unknown(message) {
  console.error(`rubric-freeze: ${message}`)
  printUsage()
  process.exit(2)
}
