
import { getCellId, parseCellId } from './formulas';

// --- Types ---

export type TokenType = 
  | 'NUMBER' | 'STRING' | 'CELL' | 'RANGE' 
  | 'PLUS' | 'MINUS' | 'MULTIPLY' | 'DIVIDE' 
  | 'LPAREN' | 'RPAREN' | 'COMMA' | 'COLON' | 'PERCENT'
  | 'IDENTIFIER' | 'EOF';

export interface Token {
  type: TokenType;
  value: string;
}

export type ASTNode = 
  | { type: 'NUMBER'; value: number }
  | { type: 'STRING'; value: string }
  | { type: 'CELL'; id: string }
  | { type: 'RANGE'; start: string; end: string }
  | { type: 'BINARY_OP'; op: string; left: ASTNode; right: ASTNode }
  | { type: 'UNARY_OP'; op: string; expr: ASTNode }
  | { type: 'CALL'; name: string; args: ASTNode[] };

// --- Tokenizer ---

const isDigit = (char: string) => /[0-9]/.test(char);
const isAlpha = (char: string) => /[a-zA-Z]/.test(char);
const isWhitespace = (char: string) => /\s/.test(char);

export class Tokenizer {
  private pos = 0;
  private text: string;

  constructor(text: string) {
    this.text = text;
  }

  getNextToken(): Token {
    if (this.pos >= this.text.length) return { type: 'EOF', value: '' };

    const char = this.text[this.pos];

    if (isWhitespace(char)) {
      this.pos++;
      return this.getNextToken();
    }

    if (isDigit(char) || char === '.') {
      let numStr = '';
      while (this.pos < this.text.length && (isDigit(this.text[this.pos]) || this.text[this.pos] === '.')) {
        numStr += this.text[this.pos];
        this.pos++;
      }
      return { type: 'NUMBER', value: numStr };
    }

    if (char === '"') {
      let str = '';
      this.pos++; // skip opening quote
      while (this.pos < this.text.length && this.text[this.pos] !== '"') {
        str += this.text[this.pos];
        this.pos++;
      }
      this.pos++; // skip closing quote
      return { type: 'STRING', value: str };
    }

    if (isAlpha(char)) {
      let ident = '';
      while (this.pos < this.text.length && (isAlpha(this.text[this.pos]) || isDigit(this.text[this.pos]))) {
        ident += this.text[this.pos];
        this.pos++;
      }
      
      // Check if it's a Cell ID (e.g. A1, ZZ123)
      if (/^[A-Z]+[0-9]+$/i.test(ident)) {
        // Look ahead for colon to detect Range like A1:B2
        if (this.text[this.pos] === ':') {
            // We handle ranges in the parser usually, but tokenizing them as discrete units simplifies things
            // Actually, let's return CELL and let parser handle COLON for range
            return { type: 'CELL', value: ident.toUpperCase() };
        }
        return { type: 'CELL', value: ident.toUpperCase() };
      }
      
      return { type: 'IDENTIFIER', value: ident.toUpperCase() };
    }

    this.pos++;
    switch (char) {
      case '+': return { type: 'PLUS', value: '+' };
      case '-': return { type: 'MINUS', value: '-' };
      case '*': return { type: 'MULTIPLY', value: '*' };
      case '/': return { type: 'DIVIDE', value: '/' };
      case '(': return { type: 'LPAREN', value: '(' };
      case ')': return { type: 'RPAREN', value: ')' };
      case ',': return { type: 'COMMA', value: ',' };
      case ':': return { type: 'COLON', value: ':' };
      case '%': return { type: 'PERCENT', value: '%' };
      default: return { type: 'STRING', value: char }; // Fallback to string for unknown chars instead of crashing
    }
  }

  getAllTokens(): Token[] {
    const tokens: Token[] = [];
    let token = this.getNextToken();
    while (token.type !== 'EOF') {
      tokens.push(token);
      token = this.getNextToken();
    }
    return tokens;
  }
}

// --- Parser ---

export class Parser {
  private tokens: Token[];
  private current = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): ASTNode {
    if (this.tokens.length === 0) return { type: 'STRING', value: '' };
    return this.expression();
  }

  private expression(): ASTNode {
    return this.term();
  }

  private term(): ASTNode {
    let left = this.factor();

    while (this.match('PLUS', 'MINUS')) {
      const op = this.previous().value;
      const right = this.factor();
      left = { type: 'BINARY_OP', op, left, right };
    }

    return left;
  }

  private factor(): ASTNode {
    let left = this.primary();

    while (this.match('MULTIPLY', 'DIVIDE')) {
      const op = this.previous().value;
      const right = this.primary();
      left = { type: 'BINARY_OP', op, left, right };
    }

    return left;
  }

  private primary(): ASTNode {
    let node: ASTNode;

    if (this.match('NUMBER')) {
        node = { type: 'NUMBER', value: parseFloat(this.previous().value) };
    } else if (this.match('STRING')) {
        node = { type: 'STRING', value: this.previous().value };
    } else if (this.match('CELL')) {
        const cellId = this.previous().value;
        if (this.match('COLON')) {
            const start = cellId;
            if (!this.match('CELL')) throw new Error("Expected cell after ':'");
            const end = this.previous().value;
            node = { type: 'RANGE', start, end };
        } else {
            node = { type: 'CELL', id: cellId };
        }
    } else if (this.match('IDENTIFIER')) {
        const name = this.previous().value;
        this.consume('LPAREN', "Expect '(' after function name.");
        const args: ASTNode[] = [];
        if (!this.check('RPAREN')) {
            do {
                args.push(this.expression());
            } while (this.match('COMMA'));
        }
        this.consume('RPAREN', "Expect ')' after arguments.");
        node = { type: 'CALL', name, args };
    } else if (this.match('LPAREN')) {
      const expr = this.expression();
      this.consume('RPAREN', "Expect ')' after expression.");
      node = expr;
    } else if (this.match('MINUS')) {
        const right = this.primary();
        node = { type: 'UNARY_OP', op: '-', expr: right };
    } else {
        // Fallback for unexpected tokens to treat as string or empty
        if (this.isAtEnd()) return { type: 'STRING', value: '' };
        throw new Error("Expect expression.");
    }

    // Handle postfix operators (PERCENT)
    while (this.match('PERCENT')) {
        // Wrap the current node in a multiplication by 0.01
        node = { type: 'BINARY_OP', op: '*', left: node, right: { type: 'NUMBER', value: 0.01 } };
    }

    return node;
  }

  private match(...types: TokenType[]): boolean {
    for (const type of types) {
      if (this.check(type)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  private check(type: TokenType): boolean {
    if (this.isAtEnd()) return false;
    return this.peek().type === type;
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }

  private isAtEnd(): boolean {
    return this.current >= this.tokens.length;
  }

  private peek(): Token {
    return this.tokens[this.current];
  }

  private previous(): Token {
    return this.tokens[this.current - 1];
  }

  private consume(type: TokenType, message: string): Token {
    if (this.check(type)) return this.advance();
    throw new Error(message);
  }
}

// --- Evaluator ---

export const evaluateAST = (node: ASTNode, getValue: (id: string) => any): any => {
  switch (node.type) {
    case 'NUMBER': return node.value;
    case 'STRING': return node.value;
    case 'CELL': {
        const val = getValue(node.id);
        const num = Number(val);
        return isNaN(num) ? val : num;
    }
    case 'RANGE': {
        // Returns an array of values
        const vals: any[] = [];
        const start = parseCellId(node.start);
        const end = parseCellId(node.end);
        if (!start || !end) return [];

        const minCol = Math.min(start.col, end.col);
        const maxCol = Math.max(start.col, end.col);
        const minRow = Math.min(start.row, end.row);
        const maxRow = Math.max(start.row, end.row);

        for (let c = minCol; c <= maxCol; c++) {
            for (let r = minRow; r <= maxRow; r++) {
                const val = getValue(getCellId(c, r));
                vals.push(Number(val) || 0);
            }
        }
        return vals;
    }
    case 'UNARY_OP': {
        const right = evaluateAST(node.expr, getValue);
        if (node.op === '-') return -right;
        return right;
    }
    case 'BINARY_OP': {
        const left = evaluateAST(node.left, getValue);
        const right = evaluateAST(node.right, getValue);
        
        if (node.op === '+') return Number(left) + Number(right);
        if (node.op === '-') return Number(left) - Number(right);
        if (node.op === '*') return Number(left) * Number(right);
        if (node.op === '/') return Number(left) / Number(right);
        return 0;
    }
    case 'CALL': {
        // Flatten arguments (handles ranges passed to functions like SUM)
        const flatArgs: number[] = [];
        node.args.forEach(arg => {
            const res = evaluateAST(arg, getValue);
            if (Array.isArray(res)) {
                res.forEach(r => flatArgs.push(Number(r) || 0));
            } else {
                flatArgs.push(Number(res) || 0);
            }
        });

        switch (node.name) {
            case 'SUM': return flatArgs.reduce((a, b) => a + b, 0);
            case 'AV': // Alias for AVG
            case 'AVG':
            case 'AVERAGE': return flatArgs.length ? flatArgs.reduce((a, b) => a + b, 0) / flatArgs.length : 0;
            case 'MIN': return flatArgs.length ? Math.min(...flatArgs) : 0;
            case 'MAX': return flatArgs.length ? Math.max(...flatArgs) : 0;
            case 'COUNT': return flatArgs.length;
            default: return "#NAME?";
        }
    }
    default: return 0;
  }
};

// --- Reference Shifter (For Copy/Paste) ---

export const shiftFormula = (formula: string, dCol: number, dRow: number): string => {
    if (!formula.startsWith('=')) return formula;

    try {
        const tokens = new Tokenizer(formula.substring(1)).getAllTokens();
        
        // Simple reconstruction strategy: 
        // Instead of building AST and serializing, we just map tokens and join them.
        // A full serializer is robust, but token mapping preserves user formatting (mostly).
        
        return '=' + tokens.map(t => {
            if (t.type === 'CELL') {
                const pos = parseCellId(t.value);
                if (!pos) return t.value;
                return getCellId(pos.col + dCol, pos.row + dRow);
            }
            return t.value;
        }).join('');
    } catch (e) {
        return formula; // Fallback if parse error
    }
};
