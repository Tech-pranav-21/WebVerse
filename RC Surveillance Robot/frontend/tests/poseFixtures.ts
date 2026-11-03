/**
 * Loads tests/fixtures/*.json: REAL responses of the Python pose service (YOLOv8 + activity engine),
 * recorded by activity-recognition/export_contract_fixtures.py. They are not written by hand.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parsePoseDetectionResult } from '../src/services/poseResponse';
import type { PoseDetectionResult, PosePerson } from '../src/types/pose';

// The tests are compiled to <root>/.test-build/tests, the fixtures stay in <root>/tests/fixtures.
export const FIXTURE_DIR = join(__dirname, '..', '..', 'tests', 'fixtures');
export const SOURCE_DIR = join(__dirname, '..', '..', 'src');

export function fixtureNames(): string[] {
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

export function rawFixture(name: string): any {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.json`), 'utf8'));
}

/** A fixture as the dashboard sees it: validated by the same parser as a live response. */
export function fixture(name: string): PoseDetectionResult {
  return parsePoseDetectionResult(rawFixture(name));
}

export function onlyPerson(name: string): PosePerson {
  const result = fixture(name);
  if (result.persons.length !== 1) throw new Error(`fixture ${name} has ${result.persons.length} persons`);
  return result.persons[0];
}

export function readSource(relative: string): string {
  return readFileSync(join(SOURCE_DIR, relative), 'utf8');
}

/** A deep copy that tests may modify. */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
