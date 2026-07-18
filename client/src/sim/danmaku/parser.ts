// 弾幕 DSL の字句解析・構文解析。描画/通信に依存しない純粋なモジュール。
// 文法は danmaku-scripts.ts の冒頭コメントを参照。

export type Expr =
  | { k: 'num'; v: number }
  | { k: 'var'; name: string }
  | { k: 'un'; op: '-' | '!'; e: Expr }
  | { k: 'bin'; op: string; l: Expr; r: Expr }
  | { k: 'call'; name: string; args: Expr[] };

export type Stmt =
  | { k: 'let'; name: string; e: Expr }
  | { k: 'assign'; name: string; e: Expr }
  | { k: 'if'; cond: Expr; then: Stmt[]; els: Stmt[] | null }
  | { k: 'loop'; count: Expr; body: Stmt[] }
  | { k: 'wait'; e: Expr }
  | { k: 'call'; name: string; args: Expr[] };

export type Program = Stmt[];

interface Token {
  type: 'num' | 'ident' | 'punct' | 'eof';
  value: string;
  line: number;
}

export class ParseError extends Error {
  constructor(message: string, line: number) {
    super(`${message} (line ${line})`);
  }
}

const PUNCTS = [
  '<=', '>=', '==', '!=', '&&', '||',
  '+', '-', '*', '/', '%', '(', ')', '{', '}', ',', ';', '=', '<', '>', '!',
];

function lex(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') {
      line++;
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      tokens.push({ type: 'num', value: src.slice(i, j), line });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      tokens.push({ type: 'ident', value: src.slice(i, j), line });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (PUNCTS.includes(two)) {
      tokens.push({ type: 'punct', value: two, line });
      i += 2;
      continue;
    }
    if (PUNCTS.includes(c)) {
      tokens.push({ type: 'punct', value: c, line });
      i++;
      continue;
    }
    throw new ParseError(`unexpected character '${c}'`, line);
  }
  tokens.push({ type: 'eof', value: '', line });
  return tokens;
}

class Parser {
  private i = 0;
  constructor(private readonly toks: Token[]) {}

  parseProgram(): Program {
    const stmts: Stmt[] = [];
    while (this.peek().type !== 'eof') stmts.push(this.parseStmt());
    return stmts;
  }

  private peek(offset = 0): Token {
    return this.toks[Math.min(this.i + offset, this.toks.length - 1)];
  }

  private next(): Token {
    return this.toks[this.i++];
  }

  private expect(value: string): Token {
    const t = this.next();
    if (t.value !== value) {
      throw new ParseError(`expected '${value}' but got '${t.value}'`, t.line);
    }
    return t;
  }

  private parseBlock(): Stmt[] {
    this.expect('{');
    const stmts: Stmt[] = [];
    while (this.peek().value !== '}') {
      if (this.peek().type === 'eof') {
        throw new ParseError(`missing '}'`, this.peek().line);
      }
      stmts.push(this.parseStmt());
    }
    this.expect('}');
    return stmts;
  }

  private parseStmt(): Stmt {
    const t = this.peek();
    if (t.type === 'ident') {
      switch (t.value) {
        case 'let': {
          this.next();
          const name = this.next();
          if (name.type !== 'ident') {
            throw new ParseError('expected variable name', name.line);
          }
          this.expect('=');
          const e = this.parseExpr();
          this.expect(';');
          return { k: 'let', name: name.value, e };
        }
        case 'wait': {
          this.next();
          this.expect('(');
          const e = this.parseExpr();
          this.expect(')');
          this.expect(';');
          return { k: 'wait', e };
        }
        case 'loop': {
          this.next();
          this.expect('(');
          const count = this.parseExpr();
          this.expect(')');
          return { k: 'loop', count, body: this.parseBlock() };
        }
        case 'if': {
          this.next();
          this.expect('(');
          const cond = this.parseExpr();
          this.expect(')');
          const then = this.parseBlock();
          let els: Stmt[] | null = null;
          if (this.peek().value === 'else') {
            this.next();
            els = this.parseBlock();
          }
          return { k: 'if', cond, then, els };
        }
      }
      // 代入 or 関数呼び出し文
      if (this.peek(1).value === '=') {
        const name = this.next().value;
        this.next(); // '='
        const e = this.parseExpr();
        this.expect(';');
        return { k: 'assign', name, e };
      }
      if (this.peek(1).value === '(') {
        const name = this.next().value;
        const args = this.parseArgs();
        this.expect(';');
        return { k: 'call', name, args };
      }
    }
    throw new ParseError(`unexpected token '${t.value}'`, t.line);
  }

  private parseArgs(): Expr[] {
    this.expect('(');
    const args: Expr[] = [];
    if (this.peek().value !== ')') {
      args.push(this.parseExpr());
      while (this.peek().value === ',') {
        this.next();
        args.push(this.parseExpr());
      }
    }
    this.expect(')');
    return args;
  }

  // 優先順位: || < && < 比較 < 加減 < 乗除剰余 < 単項 < 一次式
  private parseExpr(): Expr {
    return this.parseOr();
  }

  private parseOr(): Expr {
    let l = this.parseAnd();
    while (this.peek().value === '||') {
      this.next();
      l = { k: 'bin', op: '||', l, r: this.parseAnd() };
    }
    return l;
  }

  private parseAnd(): Expr {
    let l = this.parseCmp();
    while (this.peek().value === '&&') {
      this.next();
      l = { k: 'bin', op: '&&', l, r: this.parseCmp() };
    }
    return l;
  }

  private parseCmp(): Expr {
    let l = this.parseAdd();
    while (['<', '<=', '>', '>=', '==', '!='].includes(this.peek().value)) {
      const op = this.next().value;
      l = { k: 'bin', op, l, r: this.parseAdd() };
    }
    return l;
  }

  private parseAdd(): Expr {
    let l = this.parseMul();
    while (this.peek().value === '+' || this.peek().value === '-') {
      const op = this.next().value;
      l = { k: 'bin', op, l, r: this.parseMul() };
    }
    return l;
  }

  private parseMul(): Expr {
    let l = this.parseUnary();
    while (['*', '/', '%'].includes(this.peek().value)) {
      const op = this.next().value;
      l = { k: 'bin', op, l, r: this.parseUnary() };
    }
    return l;
  }

  private parseUnary(): Expr {
    const t = this.peek();
    if (t.value === '-' || t.value === '!') {
      this.next();
      return { k: 'un', op: t.value as '-' | '!', e: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const t = this.next();
    if (t.type === 'num') {
      const v = Number(t.value);
      if (!Number.isFinite(v)) throw new ParseError(`bad number '${t.value}'`, t.line);
      return { k: 'num', v };
    }
    if (t.type === 'ident') {
      if (this.peek().value === '(') {
        return { k: 'call', name: t.value, args: this.parseArgs() };
      }
      return { k: 'var', name: t.value };
    }
    if (t.value === '(') {
      const e = this.parseExpr();
      this.expect(')');
      return e;
    }
    throw new ParseError(`unexpected token '${t.value}'`, t.line);
  }
}

export function parse(source: string): Program {
  return new Parser(lex(source)).parseProgram();
}
