/**
 * A PostgREST-shaped client over a SQL runner — the slice of supabase-js that
 * Helm's Postgres adapters and Forge's supabase TableClient use: from(), select,
 * insert, update, eq, neq, in, is, not(col, 'is', null), gt, lte, order, limit, range,
 * single, maybeSingle, rpc, and await. It returns `{ data, error }` exactly as
 * supabase-js does, with PostgREST's error code for single() on zero or many
 * rows. Memoire's own local proofs use the same technique.
 *
 * It exists for tests only: it lets the real adapters run against a real
 * Postgres (PGlite) with the real migrations and the real policies.
 */
const IDENT = /^[a-z_][a-z0-9_]*$/;
const ident = (name) => {
  if (!IDENT.test(name)) throw new Error(`Not a plain identifier: ${name}`);
  return `"${name}"`;
};
const columnList = (cols) => (cols === undefined || cols.trim() === '*' ? '*' : cols.split(',').map((c) => ident(c.trim())).join(', '));
const param = (v) => (v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v);

class Query {
  constructor(run, table) {
    this.run = run;
    this.table = table;
    this.mode = 'select';
    this.columns = '*';
    this.returning = null;
    this.rows = null;
    this.patch = null;
    this.where = [];
    this.params = [];
    this.orders = [];
    this.limitTo = null;
    this.offsetBy = null;
    this.expect = 'many';
  }
  select(columns) {
    if (this.mode === 'select') this.columns = columns ?? '*';
    else this.returning = columns ?? '*';
    return this;
  }
  insert(rows) {
    this.mode = 'insert';
    this.rows = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  update(patch) {
    this.mode = 'update';
    this.patch = patch;
    return this;
  }
  filter(sqlFn) {
    this.where.push(sqlFn);
    return this;
  }
  eq(c, v) {
    return this.filter((p) => `${ident(c)} = ${p(v)}`);
  }
  neq(c, v) {
    return this.filter((p) => `${ident(c)} <> ${p(v)}`);
  }
  gt(c, v) {
    return this.filter((p) => `${ident(c)} > ${p(v)}`);
  }
  lte(c, v) {
    return this.filter((p) => `${ident(c)} <= ${p(v)}`);
  }
  in(c, vs) {
    return this.filter((p) => `${ident(c)} = ANY(${p([...vs])})`);
  }
  is(c, v) {
    if (v !== null) throw new Error('is() supports null only');
    return this.filter(() => `${ident(c)} IS NULL`);
  }
  not(c, op, v) {
    if (op !== 'is' || v !== null) throw new Error('not() supports is null only');
    return this.filter(() => `${ident(c)} IS NOT NULL`);
  }
  order(c, { ascending = true } = {}) {
    this.orders.push(`${ident(c)} ${ascending ? 'ASC' : 'DESC'}`);
    return this;
  }
  limit(n) {
    this.limitTo = n;
    return this;
  }
  range(from, to) {
    this.offsetBy = from;
    this.limitTo = to - from + 1;
    return this;
  }
  single() {
    this.expect = 'one';
    return this;
  }
  maybeSingle() {
    this.expect = 'maybe';
    return this;
  }
  compile() {
    const params = [];
    const p = (v) => {
      params.push(Array.isArray(v) ? v : param(v));
      return `$${params.length}`;
    };
    const where = this.where.length ? ` WHERE ${this.where.map((f) => f(p)).join(' AND ')}` : '';
    if (this.mode === 'insert') {
      const cols = Object.keys(this.rows[0]);
      const tuples = this.rows.map((r) => `(${cols.map((c) => p(r[c])).join(', ')})`);
      return { text: `INSERT INTO ${ident(this.table)} (${cols.map(ident).join(', ')}) VALUES ${tuples.join(', ')} RETURNING ${columnList(this.returning ?? '*')}`, params };
    }
    if (this.mode === 'update') {
      const sets = Object.entries(this.patch).map(([c, v]) => `${ident(c)} = ${p(v)}`);
      return { text: `UPDATE ${ident(this.table)} SET ${sets.join(', ')}${where} RETURNING ${columnList(this.returning ?? '*')}`, params };
    }
    const order = this.orders.length ? ` ORDER BY ${this.orders.join(', ')}` : '';
    const limit = (this.limitTo !== null ? ` LIMIT ${Number(this.limitTo)}` : '') + (this.offsetBy !== null ? ` OFFSET ${Number(this.offsetBy)}` : '');
    return { text: `SELECT ${columnList(this.columns)} FROM ${ident(this.table)}${where}${order}${limit}`, params };
  }
  async execute() {
    let rows;
    try {
      const { text, params } = this.compile();
      rows = (await this.run(text, params)).rows;
    } catch (e) {
      return { data: null, error: { message: e.message, code: e.code ?? 'XX000', details: e.detail ?? null } };
    }
    if (this.expect === 'one') {
      return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116', details: `${rows.length} rows` } };
    }
    if (this.expect === 'maybe') {
      return rows.length <= 1 ? { data: rows[0] ?? null, error: null } : { data: null, error: { message: 'multiple rows returned', code: 'PGRST116', details: null } };
    }
    return { data: rows, error: null };
  }
  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }
}

/** A PostgREST RPC: named arguments; a set (or a row type) comes back as rows, anything else as the bare value. */
class Rpc {
  constructor(run, fn, args) {
    this.run = run;
    this.fn = fn;
    this.args = args;
  }
  async execute() {
    try {
      const names = Object.keys(this.args);
      const shape = await this.run(
        'SELECT p.proretset AS set, t.typtype AS kind FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_type t ON t.oid = p.prorettype WHERE p.proname = $1 LIMIT 1',
        [this.fn],
      );
      const rows = (await this.run(`SELECT * FROM public.${ident(this.fn)}(${names.map((n, i) => `${ident(n)} => $${i + 1}`).join(', ')})`, names.map((n) => param(this.args[n])))).rows;
      const asRows = shape.rows[0]?.set || shape.rows[0]?.kind === 'c';
      return { data: asRows ? rows : (rows[0]?.[this.fn] ?? null), error: null };
    } catch (e) {
      return { data: null, error: { message: e.message, code: e.code ?? 'XX000', details: e.detail ?? null } };
    }
  }
  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }
}

export function postgrestClient(run) {
  return { from: (table) => new Query(run, table), rpc: (fn, args = {}) => new Rpc(run, fn, args) };
}
