import { describe, it, expect, beforeEach, vi } from 'vitest';

import { migrate, type Migrations } from '../src/helpers/migrate';
import { createWorkerdSql } from './helpers/workerd-sql';

function twoMigrations() {
  return {
    1: vi.fn((s: SqlStorage) => {
      s.exec('CREATE TABLE IF NOT EXISTS a (id INTEGER PRIMARY KEY)');
    }),
    2: vi.fn((s: SqlStorage) => {
      s.exec('CREATE TABLE IF NOT EXISTS b (id INTEGER PRIMARY KEY)');
    }),
  };
}

describe('migrate', () => {
  let sql: SqlStorage;

  beforeEach(() => {
    sql = createWorkerdSql();
  });

  function version(): number {
    return sql
      .exec<{ version: number }>('SELECT version FROM _test_version')
      .one().version;
  }

  it('applies every migration on first run', () => {
    const migrations = twoMigrations();

    migrate(sql, migrations, '_test_version');

    expect(migrations[1]).toHaveBeenCalledOnce();
    expect(migrations[2]).toHaveBeenCalledOnce();
    expect(version()).toBe(2);
  });

  it('applies nothing on re-run', () => {
    const migrations = twoMigrations();
    migrate(sql, migrations, '_test_version');

    migrate(sql, migrations, '_test_version');

    expect(migrations[1]).toHaveBeenCalledOnce();
    expect(migrations[2]).toHaveBeenCalledOnce();
    expect(version()).toBe(2);
  });

  it('applies only an appended migration', () => {
    const migrations = twoMigrations();
    migrate(sql, migrations, '_test_version');

    const third = vi.fn((s: SqlStorage) => {
      s.exec('CREATE TABLE c (id INTEGER PRIMARY KEY)');
    });
    const extended: Migrations = { ...migrations, 3: third };
    migrate(sql, extended, '_test_version');

    expect(migrations[1]).toHaveBeenCalledOnce();
    expect(migrations[2]).toHaveBeenCalledOnce();
    expect(third).toHaveBeenCalledOnce();
    expect(version()).toBe(3);
  });
});
