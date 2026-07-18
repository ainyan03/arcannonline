// 弾幕 DSL の実行機。generator をコルーチンとして使い、wait で中断・再開する。
// 乱数はシード付き (呼び出し側が与える) なので、同じスクリプト+シードなら
// どのクライアントでも同じ弾列を決定論的に再現する。
import { ParseError, type Expr, type Program, type Stmt } from './parser';

/** 1 tick あたりの実行ステップ上限 (暴走スクリプト対策) */
const MAX_OPS_PER_TICK = 20_000;
/** loop の回数上限 */
const MAX_LOOP_COUNT = 100_000;

export interface ScriptContext {
  /** 発射時の自機向き (deg) */
  dir: number;
  /** スクリプト開始からの経過 tick (エンジンが進める) */
  t: number;
  /** シード付き乱数 [0,1) */
  random: () => number;
  /** 弾の生成 */
  fire: (angleDeg: number, speed: number, dur: number, radius: number) => void;
}

class Scope {
  private readonly vars = new Map<string, number>();
  constructor(private readonly parent: Scope | null) {}

  define(name: string, v: number): void {
    this.vars.set(name, v);
  }

  assign(name: string, v: number): boolean {
    if (this.vars.has(name)) {
      this.vars.set(name, v);
      return true;
    }
    return this.parent?.assign(name, v) ?? false;
  }

  lookup(name: string): number | undefined {
    return this.vars.get(name) ?? this.parent?.lookup(name);
  }
}

interface RunState {
  ctx: ScriptContext;
  ops: number;
}

function truthy(v: number): boolean {
  return v !== 0;
}

const DEG = Math.PI / 180;

function evalExpr(e: Expr, scope: Scope, st: RunState): number {
  if (++st.ops > MAX_OPS_PER_TICK) {
    throw new Error('script exceeded op budget');
  }
  switch (e.k) {
    case 'num':
      return e.v;
    case 'var': {
      const v = scope.lookup(e.name);
      if (v !== undefined) return v;
      if (e.name === 't') return st.ctx.t;
      if (e.name === 'dir') return st.ctx.dir;
      throw new Error(`unknown variable '${e.name}'`);
    }
    case 'un': {
      const v = evalExpr(e.e, scope, st);
      return e.op === '-' ? -v : truthy(v) ? 0 : 1;
    }
    case 'bin': {
      if (e.op === '&&') {
        return truthy(evalExpr(e.l, scope, st)) && truthy(evalExpr(e.r, scope, st)) ? 1 : 0;
      }
      if (e.op === '||') {
        return truthy(evalExpr(e.l, scope, st)) || truthy(evalExpr(e.r, scope, st)) ? 1 : 0;
      }
      const l = evalExpr(e.l, scope, st);
      const r = evalExpr(e.r, scope, st);
      switch (e.op) {
        case '+': return l + r;
        case '-': return l - r;
        case '*': return l * r;
        case '/': return r === 0 ? 0 : l / r;
        case '%': return r === 0 ? 0 : l % r;
        case '<': return l < r ? 1 : 0;
        case '<=': return l <= r ? 1 : 0;
        case '>': return l > r ? 1 : 0;
        case '>=': return l >= r ? 1 : 0;
        case '==': return l === r ? 1 : 0;
        case '!=': return l !== r ? 1 : 0;
        default: throw new Error(`unknown operator '${e.op}'`);
      }
    }
    case 'call':
      return callFn(e.name, e.args.map((a) => evalExpr(a, scope, st)), st);
  }
}

function callFn(name: string, args: number[], st: RunState): number {
  switch (name) {
    case 'rand': {
      const a = args[0] ?? 0;
      const b = args[1] ?? 1;
      return a + (b - a) * st.ctx.random();
    }
    case 'sin': return Math.sin((args[0] ?? 0) * DEG);
    case 'cos': return Math.cos((args[0] ?? 0) * DEG);
    case 'floor': return Math.floor(args[0] ?? 0);
    case 'abs': return Math.abs(args[0] ?? 0);
    case 'min': return Math.min(...args);
    case 'max': return Math.max(...args);
    case 'fire': {
      st.ctx.fire(args[0] ?? 0, args[1] ?? 10, args[2] ?? 1, args[3] ?? 0.4);
      return 0;
    }
    default:
      throw new Error(`unknown function '${name}'`);
  }
}

function* execBlock(
  stmts: Stmt[],
  scope: Scope,
  st: RunState,
): Generator<number, void, void> {
  for (const s of stmts) {
    if (++st.ops > MAX_OPS_PER_TICK) {
      throw new Error('script exceeded op budget');
    }
    switch (s.k) {
      case 'let':
        scope.define(s.name, evalExpr(s.e, scope, st));
        break;
      case 'assign':
        if (!scope.assign(s.name, evalExpr(s.e, scope, st))) {
          throw new Error(`assignment to undeclared variable '${s.name}'`);
        }
        break;
      case 'if':
        if (truthy(evalExpr(s.cond, scope, st))) {
          yield* execBlock(s.then, new Scope(scope), st);
        } else if (s.els) {
          yield* execBlock(s.els, new Scope(scope), st);
        }
        break;
      case 'loop': {
        const n = Math.min(Math.floor(evalExpr(s.count, scope, st)), MAX_LOOP_COUNT);
        for (let i = 0; i < n; i++) {
          yield* execBlock(s.body, new Scope(scope), st);
        }
        break;
      }
      case 'wait': {
        const w = Math.floor(evalExpr(s.e, scope, st));
        if (w > 0) yield w;
        break;
      }
      case 'call':
        callFn(s.name, s.args.map((a) => evalExpr(a, scope, st)), st);
        break;
    }
  }
}

/** 実行中のスクリプト1本。tick() を 1/60 秒毎に呼ぶ。 */
export class ScriptRun {
  done = false;

  private readonly gen: Generator<number, void, void>;
  private readonly st: RunState;
  private waitLeft = 0;

  constructor(program: Program, ctx: ScriptContext) {
    this.st = { ctx, ops: 0 };
    this.gen = execBlock(program, new Scope(null), this.st);
  }

  tick(): void {
    if (this.done) return;
    this.st.ctx.t++;
    if (this.waitLeft > 0) {
      this.waitLeft--;
      return;
    }
    this.st.ops = 0;
    try {
      const r = this.gen.next();
      if (r.done) {
        this.done = true;
      } else {
        // yield 直後の tick から数えて r.value tick 後に再開する
        this.waitLeft = r.value - 1;
      }
    } catch (err) {
      console.warn('[danmaku] script aborted:', err);
      this.done = true;
    }
  }
}

export { ParseError };
