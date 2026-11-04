export const MAX_QUERY_CHARS = 1000
export const MAX_CONDITIONS = 20
export const MAX_DEPTH = 5

export class SearchError extends Error {
  readonly position: number

  constructor(message: string, position: number) {
    super(message)
    this.name = 'SearchError'
    this.position = position
  }
}

export type CompareOperator = '>' | '>=' | '<' | '<='

export type SearchValue = {
  text: string
  prefix: boolean
  phrase: boolean
  at: number
}

export type SearchNode =
  | { kind: 'all' }
  | { kind: 'and'; children: SearchNode[] }
  | { kind: 'or'; children: SearchNode[] }
  | { kind: 'not'; child: SearchNode }
  | { kind: 'field'; field: string; attribute: boolean; values: SearchValue[]; at: number }
  | {
      kind: 'compare'
      field: string
      attribute: boolean
      operator: CompareOperator
      value: number
      at: number
    }
  | { kind: 'term'; text: string; phrase: boolean; at: number }

type Token =
  | { kind: 'lparen' | 'rparen' | 'minus' | 'colon' | 'at'; at: number }
  | { kind: 'cmp'; operator: CompareOperator; at: number }
  | { kind: 'word' | 'phrase'; text: string; at: number }

const BREAKS = new Set(['(', ')', '"', ':', '<', '>'])

function isSpace(character: string): boolean {
  return character === ' ' || character === '\t' || character === '\n' || character === '\r'
}

function isWordCharacter(character: string): boolean {
  return !isSpace(character) && !BREAKS.has(character)
}

export function tokenise(input: string): Token[] {
  const tokens: Token[] = []
  let at = 0

  while (at < input.length) {
    const character = input[at] as string

    if (isSpace(character)) {
      at += 1
      continue
    }

    if (character === '(' || character === ')' || character === ':') {
      tokens.push({
        kind: character === '(' ? 'lparen' : character === ')' ? 'rparen' : 'colon',
        at,
      })
      at += 1
      continue
    }

    if (character === '<' || character === '>') {
      const operator = input[at + 1] === '=' ? (`${character}=` as CompareOperator) : character
      tokens.push({ kind: 'cmp', operator, at })
      at += operator.length
      continue
    }

    if (character === '"') {
      const start = at
      at += 1
      let text = ''
      let closed = false
      while (at < input.length) {
        const inside = input[at] as string
        if (inside === '\\' && (input[at + 1] === '"' || input[at + 1] === '\\')) {
          text += input[at + 1]
          at += 2
          continue
        }
        if (inside === '"') {
          closed = true
          at += 1
          break
        }
        text += inside
        at += 1
      }
      if (!closed) {
        throw new SearchError('This quote is never closed.', start)
      }
      tokens.push({ kind: 'phrase', text, at: start })
      continue
    }

    if (character === '-') {
      tokens.push({ kind: 'minus', at })
      at += 1
      continue
    }

    if (character === '@') {
      tokens.push({ kind: 'at', at })
      at += 1
      continue
    }

    const start = at
    while (at < input.length && isWordCharacter(input[at] as string)) {
      at += 1
    }
    tokens.push({ kind: 'word', text: input.slice(start, at), at: start })
  }

  return tokens
}

const KEYWORDS = new Set(['AND', 'OR', 'NOT'])

function isKeyword(token: Token | undefined, word: string): boolean {
  return token?.kind === 'word' && token.text === word
}

function searchValueOf(token: Token & { kind: 'word' | 'phrase' }): SearchValue {
  if (token.kind === 'phrase') {
    return { text: token.text, prefix: false, phrase: true, at: token.at }
  }

  const star = token.text.indexOf('*')
  if (star !== -1 && star !== token.text.length - 1) {
    throw new SearchError('A * is only allowed at the end of a value.', token.at + star)
  }
  if (star === 0) {
    throw new SearchError('A value cannot be only a *.', token.at)
  }

  return {
    text: star === -1 ? token.text : token.text.slice(0, -1),
    prefix: star !== -1,
    phrase: false,
    at: token.at,
  }
}

export function parseSearch(input: string): SearchNode {
  if (input.length > MAX_QUERY_CHARS) {
    throw new SearchError(
      `A search may be at most ${MAX_QUERY_CHARS} characters, and this one is ${input.length}.`,
      MAX_QUERY_CHARS,
    )
  }

  const tokens = tokenise(input)
  let position = 0
  let conditions = 0
  let depth = 0

  const peek = (): Token | undefined => tokens[position]
  const end = (): number => tokens[position]?.at ?? input.length

  function countCondition(at: number): void {
    conditions += 1
    if (conditions > MAX_CONDITIONS) {
      throw new SearchError(`A search may hold at most ${MAX_CONDITIONS} conditions.`, at)
    }
  }

  function deeper(at: number): void {
    depth += 1
    if (depth > MAX_DEPTH) {
      throw new SearchError(`A search may nest at most ${MAX_DEPTH} levels of brackets.`, at)
    }
  }

  function parseValues(): SearchValue[] {
    const token = peek()

    if (token?.kind === 'lparen') {
      deeper(token.at)
      position += 1
      const values: SearchValue[] = []
      for (;;) {
        const inner = peek()
        if (inner === undefined) {
          throw new SearchError('This bracket is never closed.', token.at)
        }
        if (inner.kind !== 'word' && inner.kind !== 'phrase') {
          throw new SearchError('Expected a value here.', inner.at)
        }
        values.push(searchValueOf(inner))
        position += 1

        const next = peek()
        if (next?.kind === 'rparen') {
          position += 1
          depth -= 1
          return values
        }
        if (isKeyword(next, 'OR')) {
          position += 1
          continue
        }
        throw new SearchError('Values inside brackets are separated by OR.', next?.at ?? end())
      }
    }

    if (token?.kind === 'word' || token?.kind === 'phrase') {
      position += 1
      return [searchValueOf(token)]
    }

    throw new SearchError('Expected a value after the colon.', token?.at ?? end())
  }

  function parseField(name: string, attribute: boolean, at: number): SearchNode {
    const token = peek()

    if (token?.kind === 'colon') {
      position += 1
      const values = parseValues()
      countCondition(at)
      return { kind: 'field', field: name, attribute, values, at }
    }

    if (token?.kind === 'cmp') {
      position += 1
      let sign = ''
      if (peek()?.kind === 'minus') {
        sign = '-'
        position += 1
      }
      const number = peek()
      if (number?.kind !== 'word' || !/^(?:\d+\.?\d*|\.\d+)$/.test(number.text)) {
        throw new SearchError('A comparison needs a number on the right.', number?.at ?? end())
      }
      position += 1
      countCondition(at)
      return {
        kind: 'compare',
        field: name,
        attribute,
        operator: token.operator,
        value: Number(`${sign}${number.text}`),
        at,
      }
    }

    throw new SearchError('Expected : or a comparison after this field.', token?.at ?? end())
  }

  function parsePrimary(): SearchNode {
    const token = peek()

    if (token === undefined) {
      throw new SearchError('The search ends before this part is finished.', input.length)
    }

    if (token.kind === 'lparen') {
      deeper(token.at)
      position += 1
      const inner = parseOr()
      const closing = peek()
      if (closing?.kind !== 'rparen') {
        throw new SearchError('This bracket is never closed.', token.at)
      }
      position += 1
      depth -= 1
      return inner
    }

    if (token.kind === 'at') {
      position += 1
      const key = peek()
      if (key?.kind !== 'word' || key.text === '') {
        throw new SearchError('An @ has to be followed by an attribute name.', token.at)
      }
      position += 1
      return parseField(key.text, true, token.at)
    }

    if (token.kind === 'phrase') {
      position += 1
      countCondition(token.at)
      return { kind: 'term', text: token.text, phrase: true, at: token.at }
    }

    if (token.kind === 'word') {
      if (KEYWORDS.has(token.text)) {
        throw new SearchError(`${token.text} needs something on both sides.`, token.at)
      }
      const next = tokens[position + 1]
      if (next?.kind === 'colon' || next?.kind === 'cmp') {
        position += 1
        return parseField(token.text, false, token.at)
      }
      position += 1
      const value = searchValueOf(token)
      if (value.prefix) {
        throw new SearchError(
          'A * works on the value of a field, not on a word in the message.',
          token.at + token.text.length - 1,
        )
      }
      countCondition(token.at)
      return { kind: 'term', text: value.text, phrase: false, at: token.at }
    }

    throw new SearchError('This is not where that belongs.', token.at)
  }

  function parseUnary(): SearchNode {
    const token = peek()
    if (token?.kind === 'minus' || isKeyword(token, 'NOT')) {
      position += 1
      return { kind: 'not', child: parseUnary() }
    }
    return parsePrimary()
  }

  function startsAnother(): boolean {
    const token = peek()
    if (token === undefined || token.kind === 'rparen') {
      return false
    }
    return !isKeyword(token, 'OR')
  }

  function parseAnd(): SearchNode {
    const children = [parseUnary()]
    for (;;) {
      if (isKeyword(peek(), 'AND')) {
        position += 1
        children.push(parseUnary())
        continue
      }
      if (!startsAnother()) {
        break
      }
      children.push(parseUnary())
    }
    return children.length === 1 ? (children[0] as SearchNode) : { kind: 'and', children }
  }

  function parseOr(): SearchNode {
    const children = [parseAnd()]
    while (isKeyword(peek(), 'OR')) {
      position += 1
      children.push(parseAnd())
    }
    return children.length === 1 ? (children[0] as SearchNode) : { kind: 'or', children }
  }

  if (tokens.length === 0) {
    return { kind: 'all' }
  }

  const node = parseOr()
  const left = peek()
  if (left !== undefined) {
    throw new SearchError('This is not where that belongs.', left.at)
  }
  return node
}
