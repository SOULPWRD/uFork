// uFork Scheme compiler

// Transforms Scheme source code into an intermediate representation
// that is suitable for loading.

// The intermediate representation is described in crlf.md.

const ignored = function () {};
let info_log = console.log;  // Low volume, always shown unless all logging is disabled.
let warn_log = ignored;  // Something went wrong, but perhaps it wasn't fatal.
let debug_log = ignored;  // More detail to narrow down the source of a problem.
let trace_log = ignored;  // Extremely detailed, but very high volume.
//debug warn_log = console.log;
//debug debug_log = console.log;
// trace_log = console.log;

let asm_label = 0;  // used by `to_asm()`
/*
prefixes {a, d, f, i, j, k, n, t, v, x, y}
    if: t, f, j
    instr: i, k
    quad: x, y
    pair: a, d
    dict: v, n
*/

/*
 * uFork/CRLF elements
 */

const undef_lit =   { "kind": "literal", "value": "undef" };
const nil_lit =     { "kind": "literal", "value": "nil" };
const false_lit =   { "kind": "literal", "value": "false" };
const true_lit =    { "kind": "literal", "value": "true" };
const unit_lit =    { "kind": "literal", "value": "unit" };

const literal_t =   { "kind": "type", "name": "literal" };
const type_t =      { "kind": "type", "name": "type" };
const fixnum_t =    { "kind": "type", "name": "fixnum" };
const actor_t =     { "kind": "type", "name": "actor" };
const instr_t =     { "kind": "type", "name": "instr" };
const pair_t =      { "kind": "type", "name": "pair" };
const dict_t =      { "kind": "type", "name": "dict" };

function new_quad(t, x, y, z) {
    const value = { "kind": "quad", t };
    if (x !== undefined) {
        value.x = x;
        if (y !== undefined) {
            value.y = y;
            if (z !== undefined) {
                value.z = z;
            }
        }
    }
    return value;
}

function new_type(arity) {
    //return new_quad(type_t, arity);
    return { "kind": "type", arity };
}

function new_pair(head, tail) {
    return { "kind": "pair", head, tail };
}

function new_dict(key, value, next = nil_lit) {
    return { "kind": "dict", key, value, next };
}

function new_ref(name) {
    return { "kind": "ref", name };
}

function new_instr(op, imm = undef_lit, k = undef_lit) {
    if (k?.error) {
        return k;
    }
    return { "kind": "instr", op, imm, k };
}

function new_if_instr(t = undef_lit, f = undef_lit) {
    if (t?.error) {
        return t;
    }
    if (f?.error) {
        return f;
    }
    return { "kind": "instr", "op": "if", t, f };
}

// standard instruction-stream tails
const std = {};
std.sink_beh =
std.commit =
    new_instr("end", "commit");
std.send_msg =
    new_instr("send", -1,
    std.commit);
std.cust_send =
    new_instr("msg", 1,
    std.send_msg);
std.rv_self =
    new_instr("my", "self",
    std.cust_send);
std.resend =
    new_instr("msg", 0,
    new_instr("my", "self",
    std.send_msg));

function length_of(sexpr) {
    let n = 0;
    while (sexpr?.kind === "pair") {
        n += 1;
        sexpr = sexpr?.tail;
    }
    return n;
}

function equal_to(expect, actual) {
    if (expect === actual) {
        return true;
    }
    if (expect?.kind && (expect?.kind === actual?.kind)) {
        if (expect.kind === "pair") {
            while (expect.tail?.kind === "pair") {
                if (actual?.tail?.kind !== "pair") {
                    return false;
                }
                if (!equal_to(expect.head, actual?.head)) {
                    return false;
                }
                expect = expect.tail;
                actual = actual?.tail;
            }
            return equal_to(expect.tail, actual?.tail);
        } else if (expect.kind === "dict") {
            while (expect.tail?.kind === "dict") {
                if (actual?.tail?.kind !== "dict") {
                    return false;
                }
                // FIXME: dictionaries are unordered...
                if (!equal_to(expect.key, actual?.key)) {
                    return false;
                }
                if (!equal_to(expect.value, actual?.value)) {
                    return false;
                }
                expect = expect.next;
                actual = actual?.next;
            }
            return equal_to(expect.next, actual?.next);
        } else if (expect.kind === "literal") {
            return equal_to(expect?.value, actual?.value);
        } else if (expect.kind === "type") {
            return equal_to(expect?.name, actual?.name);
        } else if (expect.kind === "instr") {
            if (expect?.op !== actual?.op) {
                return false;
            }
            if (expect?.op === "if") {
                return equal_to(expect?.t, actual?.t)
                    && equal_to(expect?.f, actual?.f);
            }
            return equal_to(expect?.imm, actual?.imm)
                && equal_to(expect?.k, actual?.k);
        } else if (expect.kind === "ref") {
            return equal_to(expect?.name, actual?.name)
                && equal_to(expect?.module, actual?.module);
        }
    }
    return false;
}

// Scheme s-expressions (sexprs) are represented by uFork-ASM CRLF objects.
//    * symbol = <string>
//    * cons = { "kind": "pair", "head": <sexpr>, "tail": <sexpr> }
//    * literal = { "kind": "literal", "name": <string> }
//    * number = <number>
//    * type = { "kind": "type", "name": <string> }

function to_scheme(crlf) {
    if (typeof crlf === "object") {
        const kind = crlf.kind;
        if (typeof kind === "string") {
            if (kind === "pair") {
                let s = "(";
                while (true) {
                    s += to_scheme(crlf?.head);
                    if (crlf?.tail?.kind !== "pair") {
                        break;
                    }
                    crlf = crlf?.tail;
                    s += " ";
                }
                if (!equal_to(nil_lit, crlf?.tail)) {
                    s += " . ";
                    s += to_scheme(crlf?.tail);
                }
                s += ")";
                return s;
            } else if (kind === "dict") {
                let s = "{";
                while (true) {
                    s += to_scheme(crlf?.key) + ":" + to_scheme(crlf?.value);
                    if (crlf?.next?.kind !== "dict") {
                        break;
                    }
                    crlf = crlf?.next;
                    s += ",";
                }
                s += "}";
                return s;
            } else if (kind === "literal") {
                const name = crlf?.value;
                if (name === "undef") {
                    return "#?";
                } else if (name === "nil") {
                    return "()";
                } else if (name === "false") {
                    return "#f";
                } else if (name === "true") {
                    return "#t";
                } else if (name === "unit") {
                    return "#unit";
                }
            } else if (kind === "type") {
                const name = crlf?.name;
                if (typeof name === "string") {
                    return "#" + name + "_t";
                } else {
                    return "#unknown_t";
                }
            } else if (kind === "instr") {
                let s = "[#instr_t, ";
                s += to_scheme(crlf?.op);
                s += ", ";
                s += to_scheme(crlf?.imm);
                s += ", ";
                s += to_scheme(crlf?.k);
                s += "]";
                return s;
            } else if (kind === "quad") {
                let s = "[";
                s += to_scheme(crlf?.t);
                s += ", ";
                s += to_scheme(crlf?.x);
                s += ", ";
                s += to_scheme(crlf?.y);
                s += ", ";
                s += to_scheme(crlf?.z);
                s += "]";
                return s;
            } else {
                return "#" + kind + "...";
            }
        }
        return "#unknown";
    }
    if (typeof crlf === "string") {
        return crlf;
    }
    return String(crlf);
}

/*
 * Scheme language parsing
 */

function parse(source) {

    function string_input(string, start = 0) {
        if (typeof string !== "string") {
            throw new Error("string required");
        }
        return function next_char() {
            const code = string.codePointAt(start);
            //trace_log("next_char", code, "at", start);
            if (code === undefined) {
                return {
                    error: "end of input",
                    source: string,
                    start,
                    end: start
                }
            }
            const end = start + (code <= 0xFFFF ? 1 : 2);
            return {
                token: String.fromCodePoint(code),
                code: code,
                source: string,
                start,
                end,
                next: string_input(string, end)
            };
        };
    }

    function skip_comment(next) {
        while (true) {
            let input = next();
            if (input.error) {
                return next;  // stop on error
            }
            if (input.token === "\r") {
                next = input.next;
                input = next();
                if (input.error) {
                    return next;
                }
                if (input.token === "\n") {
                    return input.next;
                }
                return next;
            } else if (input.token === "\n") {
                return input.next;
            }
            next = input.next;
        }
    }

    function skip_whitespace(next) {
        while (true) {
            let input = next();
            if (input.error) {
                return next;  // stop on error
            }
            if (input.token === ";") {
                next = skip_comment(input.next);
            } else if (/[ \t-\r]/.test(input.token)) {
                next = input.next;
            } else {
                return next;  // stop on non-whitespace
            }
        }
    }

    function lex_input(next_char) {
        if (typeof next_char !== "function") {
            throw new Error("function required");
        }
        return function next_token() {
            let next = skip_whitespace(next_char);
            const input = next();
            //trace_log("next_token", input);
            if (input.error) {
                return input;  // report error
            }
            if (/[().'`]/.test(input.token)) {
                input.next = lex_input(input.next);
                return input;  // single-character token
            } else if (input.token === ",") {
                const peek = input.next();
                if (peek.error) {
                    return peek;  // report error
                }
                if (peek.token === "@") {
                    // extend token
                    input.token += peek.token;
                    input.end = peek.end;
                    input.next = peek.next;
                }
                input.next = lex_input(input.next);
                return input;
            }
            let scan = input;
            delete input.code;
            while (true) {
                next = scan.next;
                scan = next();
                if (scan.error) {
                    break;  // stop on error
                }
                if (/[-+a-zA-Z0-9!$%&*./:<=>?@\\^_|~]/.test(scan.token)) {
                    // accumulate token characters
                    input.token += scan.token;
                    input.end = scan.end;
                } else {
                    break;
                }
            }
            if (input.token === "#?") {
                input.token = undef_lit;
            } else if (input.token === "#nil") {
                input.token = nil_lit;
            } else if (input.token === "#f") {
                input.token = false_lit;
            } else if (input.token === "#t") {
                input.token = true_lit;
            } else if (input.token === "#unit") {
                input.token = unit_lit;
            } else if (input.token.startsWith("#")) {
                input.error = "unknown literal";  // convert to error
            } else {
                const number = Number(input.token);  // FIXME: implement better conversion method
                if (Number.isSafeInteger(number)) {
                    input.token = number;
                }
            }
            input.next = lex_input(next);
            return input;
        }
    }

    function parse_tail(next) {
        let input = next();
        trace_log("parse_tail", input);
        if (input.error) {
            return input;  // report error
        }
        if (input.token === ")") {
            input.token = nil_lit;
            return input;
        }
        if (input.token === ".") {
            let tail = parse_sexpr(input.next);
            let scan = tail.next();
            if (scan.token !== ')') {
                scan.error = "expected ')'";
                return scan;
            }
            tail.end = scan.end;
            tail.next = scan.next;
            return tail;
        }
        let scan = parse_sexpr(next);
        if (scan.error) {
            return scan;  // report error
        }
        let tail = parse_tail(scan.next);
        if (tail.error) {
            return tail;  // report error
        }
        input.token = new_pair(scan.token, tail.token);
        input.end = tail.end;
        input.next = tail.next;
        return input;
    }

    function parse_list(input) {
        let next = input.next;
        let scan = next();
        trace_log("parse_list", scan);
        if (scan.error) {
            return scan;  // report error
        }
        if (scan.token === ")") {
            input.token = nil_lit;
            input.end = scan.end;
            input.next = scan.next;
            return input;
        }
        if (scan.token === ".") {
            return {
                error: "unexpected dot",
                start: input.start,
                end: scan.end
            };            
        }
        scan = parse_sexpr(next);
        if (scan.error) {
            return scan;  // report error
        }
        let tail = parse_tail(scan.next);
        if (tail.error) {
            return tail;  // report error
        }
        input.token = new_pair(scan.token, tail.token);
        input.end = tail.end;
        input.next = tail.next;
        return input;
    }

    function parse_quote(input, quote) {
        let scan = parse_sexpr(input.next);
        trace_log("parse_quote", scan);
        if (scan.error) {
            return scan;  // report error
        }
        input.token = new_pair(quote, new_pair(scan.token, nil_lit));
        input.end = scan.end;
        input.next = scan.next;
        return input;
    }

    function parse_sexpr(next) {
        const input = next();
        trace_log("parse_sexpr", input);
        if (input.error) {
            return input;  // report error
        }
        if (typeof input.token === "number") {
            return input;  // number sexpr
        }
        if (input.token === ".") {
            return {
                error: "unexpected dot",
                start: input.start,
                end: input.end
            };            
        }
        if (input.token === "(") {
            return parse_list(input);
        }
        if (input.token === "'") {
            return parse_quote(input, "quote");
        }
        if (input.token === "`") {
            return parse_quote(input, "quasiquote");
        }
        if (input.token === ",") {
            return parse_quote(input, "unquote");
        }
        if (input.token === ",@") {
            return parse_quote(input, "unquote-splicing");
        }
        if (typeof input.token === "string") {
            return input;  // symbol sexpr
        }
        return {
            error: "unexpected token",
            token: input.token,
            start: input.start,
            end: input.end
        };
    }

    const str_in = string_input(source);
    let lex_in = lex_input(str_in);
    let sexprs = [];

    while (true) {
        const parse = parse_sexpr(lex_in);
        trace_log("parse:", JSON.stringify(parse, undefined, 2));
        if (parse?.error) {
            if (parse.error === "end of input") {
                break;
            }
            return parse;
        }
        sexprs.push(parse.token);
        lex_in = parse.next;
    }

    return sexprs;
}

// Tokenizer ///////////////////////////////////////////////////////////////////

function tag_regexp(strings) {

// A tag function that creates a RegExp from a template literal string. Any
// whitespace in the string is ignored, and so can be injected into the pattern
// to improve readability.

    return new RegExp(strings.raw[0].replace(/\s/g, ""), "");
}

const rx_token_raw = tag_regexp `
    (
        [ \u0020 \t-\r ]+
        | ; .*
    )
    | (
        [ - + a-z A-Z 0-9 ! # $ % & * . / : < = > ? @ \\ ^ _ | ~ ]+
    )
    | (
        [ ( ) ' \u0060 ]
        | , @?
    )
`;

// Capturing groups:
//  [1] Space
//  [2] Name
//  [3] Punctuator

function tokenize(source) {
    let rx_token = new RegExp(rx_token_raw, "yu"); // sticky, unicode aware
    let line_nr = 1;
    let column_to = 1;
    return function token_generator() {

        function error() {
            source = undefined;
            return {
                id: "error",
                line_nr,
                column_nr: column_to
            };
        }

        if (source === undefined) {
            return error();
        }
        if (rx_token.lastIndex >= source.length) {
            return;
        }
        let captives = rx_token.exec(source);
        if (!captives) {
            return error();
        }
        let column_nr = column_to;
        column_to = column_nr + captives[0].length;
        if (captives[1]) {
            return {
                id: "space",
                line_nr,
                column_nr,
                column_to
            };
        }
        if (captives[2]) {
            return {
                id: "name",
                name: captives[2],
                line_nr,
                column_nr,
                column_to
            };
        }
        if (captives[3]) {
            return {
                id: captives[3],
                line_nr,
                column_nr,
                column_to
            };
        }
    };
}
    
/*
 * Scheme interpreter/compiler
 */

function compile(source) {

    const module_env = {
        "symbol_t": new_type(1),
        "closure_t": new_type(2),
        "~empty_env": new_pair(nil_lit, nil_lit), // (())  ; NOTE: this is the same value as EMPTY_DQ
        "~cont_beh":
            new_instr("state", 1,       // msg
            new_instr("my", "self",     // msg SELF
            new_instr("send", -1,       // --
            new_instr("state", 3,       // env
            new_instr("state", 4,       // env sp
            new_instr("msg", 0,         // env sp rv
            new_instr("pair", 1,        // env sp'=(rv . sp)
            new_instr("pair", 1,        // (sp' . env)
            new_instr("state", 2,       // (sp' . env) cont
            new_instr("beh", -1,        // --
            std.commit))))))))))
    };

    const symbol_t = new_ref("symbol_t");
    const closure_t = new_ref("closure_t");
    const empty_env = new_ref("~empty_env");
    const cont_beh = new_ref("~cont_beh");

    // Return the 'nth' item from a list of pairs, if defined.
    //
    //           0          -1          -2          -3
    //      lst -->[car,cdr]-->[car,cdr]-->[car,cdr]-->...
    //            +1 |        +2 |        +3 |
    //               V           V           V
    //
    function nth_sexpr(sexpr, n) {
        while (true) {
            if (n === 0) {
                return sexpr;
            }
            if (sexpr?.kind !== "pair") {
                return undefined;
            }
            if (n === 1) {
                return sexpr?.head;
            }
            sexpr = sexpr?.tail;
            n += (n < 0) ? 1 : -1;
        }
    }

    function pattern_to_map(pattern, n = 0) {
        const map = {};
        while (pattern?.kind === "pair") {
            n += 1;
            const head = pattern?.head;
            if (typeof head === "string") {
                if (head !== "_") {
                    map[head] = n;
                }
            }
            pattern = pattern?.tail;
        }
        if (typeof pattern === "string") {
            if (pattern !== "_") {
                map[pattern] = -n;
            }
        }
        return map;
    }

    function string_to_list(str, ofs = 0) {
        const code = str.codePointAt(ofs);
        if (code === undefined) {
            return nil_lit;
        }
        ofs += (code <= 0xFFFF ? 1 : 2);
        return new_pair(code, string_to_list(str, ofs));
    }

    function sexpr_to_crlf(sexpr) {
        if (typeof sexpr === "number") {
            return sexpr;
        }
        if (typeof sexpr === "string") {
            // Symbol
            const name = "'" + sexpr;
            let symbol = module_env[name];
            if (!symbol) {
                symbol = new_quad(symbol_t, string_to_list(sexpr));
                module_env[name] = symbol;
            }
            return new_ref(name);
        }
        const kind = sexpr?.kind;
        if (kind === "literal" || kind === "type") {
            return sexpr;
        }
        if (kind === "pair") {
            const head = sexpr_to_crlf(sexpr.head);
            if (head.error) {
                return head;
            }
            const tail = sexpr_to_crlf(sexpr.tail);
            if (head.error) {
                return head;
            }
            return new_pair(head, tail);
        }
        return {
            error: "unknown sexpr",
            sexpr
        };
    }

    function constant_value(crlf) {  // return constant value for crlf, if it has one
        const type = typeof crlf;
        if (type === "number") {
            return crlf;
        }
        if (type === "object") {
            const kind = crlf.kind;
            if (kind === "literal" || kind === "type") {
                return crlf;
            }
            if (kind === "pair" && crlf.head === "quote") {
                const sexpr = nth_sexpr(crlf, 2);
                return sexpr_to_crlf(sexpr);
            }
        }
        return undefined;  // not a constant
    }

    const prim_map = {
        "lambda": xlat_lambda,
        "quote": xlat_quote,
        "car": xlat_car,
        "cdr": xlat_cdr,
        "cadr": xlat_cadr,
        "caar": xlat_caar,
        "cdar": xlat_cdar,
        "cddr": xlat_cddr,
        "caddr": xlat_caddr,
        "cadar": xlat_cadar,
        "cdddr": xlat_cdddr,
        "cadddr": xlat_cadddr,
        "cons": xlat_cons,
        "list": xlat_list,
        "eq?": xlat_eq_p,
        "null?": xlat_null_p,
        "pair?": xlat_pair_p,
        "boolean?": xlat_boolean_p,
        "number?": xlat_number_p,
        "symbol?": xlat_symbol_p,
        "<": xlat_lt_num,
        "<=": xlat_le_num,
        "=": xlat_eq_num,
        ">=": xlat_ge_num,
        ">": xlat_gt_num,
        "+": xlat_add_num,
        "-": xlat_sub_num,
        "*": xlat_mul_num,
        "not": xlat_not,
        "if": xlat_if
    };

    const module_ctx = {  // FIXME: make *_ctx into functions that create fresh instances
        number: xlat_literal,
        type: xlat_literal,
        literal: xlat_literal,
        string: xlat_variable,
        pair: xlat_invoke,
        func_map: Object.assign(
            {},
            prim_map,
            {
                "define": eval_define,
                "SEND": xlat_SEND,
            })
    };

    function eval_define(ctx, args, k) {
        const symbol = nth_sexpr(args, 1);
        debug_log("define:", "symbol:", to_scheme(symbol));
        if (typeof symbol !== "string") {
            return {
                error: "string (symbol) expected",
                symbol,
                ctx
            };
        }
        const expr = nth_sexpr(args, 2);
        debug_log("define:", "expr:", to_scheme(expr));
        const child = Object.assign({}, define_ctx);
        child.parent = ctx;
        const value = interpret(child, expr);  // evaluate expression
        if (value?.error) {
            return value;
        }
        module_env[symbol] = value;  // bind symbol in top-level environment
        return k;  // no code produced
    }

    const define_ctx = { // { literal, variable, invoke }
        number: eval_literal,
        type: eval_literal,
        literal: eval_literal,
        string: eval_variable,
        pair: eval_invoke,
        func_map: {
            "lambda": eval_lambda,
            "quote": eval_quote
        }
    };

    function eval_literal(ctx, crlf) {
        return crlf;
    }

    function eval_variable(ctx, crlf) {
        const xlat = ctx.func_map && ctx.func_map[crlf];
        if (typeof xlat === "function") {
            // operative function
            return xlat;
        }
        // symbolic reference
        return new_ref(crlf);
    }

    function eval_invoke(ctx, crlf) {
        const func = crlf.head;
        const args = crlf.tail;
        let xlat = interpret(ctx, func);
        if (typeof xlat === "function") {
            return xlat(ctx, args);
        }
        return {
            error: "unable to invoke",
            func,
            args,
            xlat,
            ctx
        };
    }

    function eval_lambda(ctx, args) {
        let code = interpret_lambda(ctx, args);
        if (code.error) {
            return code;
        }
        let data = empty_env;
        return new_quad(closure_t, code, data);
    }

    function eval_quote(ctx, args) {
        const sexpr = nth_sexpr(args, 1);
        return sexpr_to_crlf(sexpr);
    }

    const lambda_ctx = {
        number: xlat_literal,
        type: xlat_literal,
        literal: xlat_literal,
        string: xlat_variable,
        pair: xlat_invoke,
        func_map: Object.assign({
            "BEH": xlat_BEH,
            "SEND": xlat_SEND,
        }, prim_map),
        state_maps: [],
        msg_map: {}
    };

    function xlat_literal(ctx, crlf, k) {
        let code = new_instr("push", crlf, k);
        return code;
    }

    function xlat_variable(ctx, crlf, k) {
        const msg_n = ctx.msg_map && ctx.msg_map[crlf];
        if (typeof msg_n === "number") {
            // message variable
            return new_instr("msg", msg_n, k);
        }
        if (ctx.state_maps) {
            // search lexical scope(s)
            const index = ctx.state_maps.findIndex((map) => (typeof map[crlf] === "number"));
            if (index >= 0) {
                // state variable
                const offset = ctx.state_maps[index][crlf];
                const code =
                    new_instr("state", index + 2,
                    new_instr("nth", offset, k));
                return code;
            }
        }
        // free variable
        const xlat = ctx.func_map && ctx.func_map[crlf];
        if (typeof xlat === "function") {
            // operative function
            return xlat;
        }
        // module environment
        let ref = new_ref(crlf);
        return new_instr("push", ref, k);
    }

    function xlat_invoke(ctx, crlf, k) {
        const func = crlf.head;
        const args = crlf.tail;
        let xlat = interpret(ctx, func);
        if (typeof xlat === "function") {
            // apply operative immediately
            return xlat(ctx, args, k);
        }
        const nargs = length_of(args) + 1;  // account for customer
        if (equal_to(std.cust_send, k)) {
            // tail-call optimization
            let code =
                interpret_args(ctx, args,   // args...
                new_instr("msg", 1,         // args... cust
                interpret(ctx, func,        // args... cust closure
                new_instr("new", -2,        // args... cust beh.(state)
                new_instr("send", nargs,    // --
                std.commit)))));
            return code;
        } else {
            // construct continuation
            let beh =
                new_instr("state", 1,       // sp=(...)
                new_instr("part", -1, k));  // ...
            let code =
                interpret_args(ctx, args,   // ... args...
                new_instr("my", "self",     // ... args... SELF
                interpret(ctx, func,        // ... args... cust closure
                new_instr("new", -2,        // ... args... SELF beh.(state)
                new_instr("send", nargs,    // ...
                new_instr("pair", -1,       // sp=(...)
                new_instr("state", -1,      // sp env
                new_instr("push", beh,      // sp env beh
                new_instr("msg", 0,         // sp env beh msg
                new_instr("push", cont_beh, // sp env beh msg cont_beh
                new_instr("beh", 4,         // --
                std.commit)))))))))));
            return code;
        }
    }

    function xlat_lambda(ctx, args, k) {
        let code = interpret_lambda(ctx, args);
        if (code.error) {
            return code;
        }
        code =
            new_instr("state", -1,          // env
            new_instr("msg", 0,             // env msg
            new_instr("push", nil_lit,      // env msg sp=()
            new_instr("pair", 2,            // data=(() msg . env)
            new_instr("push", code,         // data code
            new_instr("push", closure_t,    // data code #closure_t
            new_instr("quad", 3,            // [#closure_t, code, data, #?]
            k)))))));
        return code;
    }

    function xlat_quote(ctx, args, k) {
        const sexpr = nth_sexpr(args, 1);
        const crlf = sexpr_to_crlf(sexpr);
        let code = new_instr("push", crlf, k);
        return code;
    }

    function xlat_BEH(ctx, args, k) {
        const ptrn = nth_sexpr(args, 1);
        const body = nth_sexpr(args, -1);
        debug_log("BEH:", "ptrn:", to_scheme(ptrn));
        debug_log("BEH:", "body:", to_scheme(body));
        const child = Object.assign({}, BEH_ctx);
        child.parent = ctx;
        if (ctx.state_maps) {
            child.state_maps = ctx.state_maps.slice();
        }
        child.state_maps.unshift(ctx.msg_map);  // add msg to lexically-captured state
        debug_log("BEH:", "state_maps:", child.state_maps);
        child.msg_map = pattern_to_map(ptrn);
        debug_log("BEH:", "msg_map:", child.msg_map);
        const func_map = Object.assign({}, ctx.func_map);  // inherit from parent
        child.func_map = Object.assign(func_map, child.func_map);  // override in child
        let code =
            interpret_seq(child, body,
            std.commit);
        return code;
    }

    function xlat_SEND(ctx, args, k) {
        const target = nth_sexpr(args, 1);
        const msg = nth_sexpr(args, 2);
        let code =
            interpret(ctx, msg,             // msg
            interpret(ctx, target,          // msg target
            new_instr("send", -1, k)));     // --
        return code;
    }

    function xlat_car(ctx, args, k) {
        const pair = nth_sexpr(args, 1);
        let code =
            interpret(ctx, pair,            // (head . tail)
            new_instr("nth", 1, k));        // head
        return code;
    }

    function xlat_cdr(ctx, args, k) {
        const pair = nth_sexpr(args, 1);
        let code =
            interpret(ctx, pair,            // (head . tail)
            new_instr("nth", -1, k));       // tail
        return code;
    }

    function xlat_cadr(ctx, args, k) {
        const pair = nth_sexpr(args, 1);
        let code =
            interpret(ctx, pair,            // pair=(head . tail)
            new_instr("nth", 2, k));        // car(cdr(pair))
        return code;
    }

    function xlat_caar(ctx, args, k) {
        const pair = nth_sexpr(args, 1);
        let code =
            interpret(ctx, pair,            // pair=(head . tail)
            new_instr("nth", 1,             // car(pair)
            new_instr("nth", 1, k)));       // car(car(pair))
        return code;
    }

    function xlat_cdar(ctx, args, k) {
        const pair = nth_sexpr(args, 1);
        let code =
            interpret(ctx, pair,            // pair=(head . tail)
            new_instr("nth", 1,             // car(pair)
            new_instr("nth", -1, k)));      // cdr(car(pair))
        return code;
    }

    function xlat_cddr(ctx, args, k) {
        const pair = nth_sexpr(args, 1);
        let code =
            interpret(ctx, pair,            // pair=(head . tail)
            new_instr("nth", -2, k));       // cdr(cdr(pair))
        return code;
    }

    function xlat_caddr(ctx, args, k) {
        const pair = nth_sexpr(args, 1);
        let code =
            interpret(ctx, pair,            // pair=(head . tail)
            new_instr("nth", 3, k));        // car(cdr(cdr(pair)))
        return code;
    }

    function xlat_cadar(ctx, args, k) {
        const pair = nth_sexpr(args, 1);
        let code =
            interpret(ctx, pair,            // pair=(head . tail)
            new_instr("nth", 1,             // car(pair)
            new_instr("nth", -1,            // cdr(car(pair))
            new_instr("nth", 1, k))));      // car(cdr(car(pair)))
        return code;
    }

    function xlat_cdddr(ctx, args, k) {
        const pair = nth_sexpr(args, 1);
        let code =
            interpret(ctx, pair,            // pair=(head . tail)
            new_instr("nth", -3, k));       // cdr(cdr(cdr(pair)))
        return code;
    }

    function xlat_cadddr(ctx, args, k) {
        const pair = nth_sexpr(args, 1);
        let code =
            interpret(ctx, pair,            // pair=(head . tail)
            new_instr("nth", 4, k));        // car(cdr(cdr(cdr(pair))))
        return code;
    }

    function xlat_cons(ctx, args, k) {
        const head = nth_sexpr(args, 1);
        const tail = nth_sexpr(args, 2);
        let code =
            interpret(ctx, tail,            // tail
            interpret(ctx, head,            // tail head
            new_instr("pair", 1, k)));      // (head . tail)
        return code;
    }

    function xlat_list(ctx, args, k) {
        let n = length_of(args);
        let code =
            new_instr("push", nil_lit,  // ()
            interpret_args(ctx, args,   // () args...
            new_instr("pair", n, k)));  // (args...)
        return code;
    }

    function xlat_eq_p(ctx, args, k) {
        const expect = nth_sexpr(args, 1);
        const actual = nth_sexpr(args, 2);
        const e_const = constant_value(expect);
        const a_const = constant_value(actual);
        if (e_const !== undefined) {
            if (a_const !== undefined) {
                if (equal_to(e_const, a_const)) {
                    return new_instr("push", true_lit, k);
                }
                return new_instr("push", false_lit, k);
            }
            let code =
                interpret(ctx, actual,          // actual
                new_instr("eq", e_const, k));   // actual==expect
            return code;
        }
        if (a_const !== undefined) {
            let code =
                interpret(ctx, expect,          // expect
                new_instr("eq", a_const, k));   // expect==actual
            return code;
        }
        let code =
            interpret(ctx, expect,          // expect
            interpret(ctx, actual,          // expect actual
            new_instr("cmp", "eq", k)));    // expect==actual
        return code;
    }

    function xlat_null_p(ctx, args, k) {
        const value = nth_sexpr(args, 1);
        let code =
            interpret(ctx, value,           // value
            new_instr("eq", nil_lit, k));   // value==()
        return code;
    }

    function xlat_pair_p(ctx, args, k) {
        const value = nth_sexpr(args, 1);
        let code =
            interpret(ctx, value,           // value
            new_instr("typeq", pair_t,      // is_pair(value)
            k));
        return code;
    }

    function xlat_boolean_p(ctx, args, k) {
        const value = nth_sexpr(args, 1);
        let k_t = new_instr("push", true_lit, k);
        let k_f = new_instr("push", false_lit, k);
        let code =
            interpret(ctx, value,           // value
            new_instr("dup", 1,             // value value
            new_instr("eq", true_lit,       // value value==#t
            new_if_instr(k,                 // value
            new_instr("eq", false_lit,      // value==#f
            new_if_instr(k_t, k_f))))));
        return code;
    }

    function xlat_number_p(ctx, args, k) {
        const value = nth_sexpr(args, 1);
        let code =
            interpret(ctx, value,           // value
            new_instr("typeq", fixnum_t,    // is_number(value)
            k));
        return code;
    }

    function xlat_symbol_p(ctx, args, k) {
        const value = nth_sexpr(args, 1);
        let code =
            interpret(ctx, value,           // value
            new_instr("typeq", symbol_t,    // is_symbol(value)
            k));
        return code;
    }

    function xlat_lt_num(ctx, args, k) {
        const n = nth_sexpr(args, 1);
        const m = nth_sexpr(args, 2);
        let code =
            interpret(ctx, n,               // n
            interpret(ctx, m,               // n m
            new_instr("cmp", "lt", k)));    // n<m
        return code;
    }

    function xlat_le_num(ctx, args, k) {
        const n = nth_sexpr(args, 1);
        const m = nth_sexpr(args, 2);
        let code =
            interpret(ctx, n,               // n
            interpret(ctx, m,               // n m
            new_instr("cmp", "le", k)));    // n<=m
        return code;
    }

    function xlat_eq_num(ctx, args, k) {
        return xlat_eq_p(ctx, args, k);    // FIXME: add numeric type-checks?
        /*
        const n = nth_sexpr(args, 1);
        const m = nth_sexpr(args, 2);
        let code =
            interpret(ctx, n,               // n
            interpret(ctx, m,               // n m
            new_instr("cmp", "eq", k)));    // n==m
        return code;
        */
    }

    function xlat_ge_num(ctx, args, k) {
        const n = nth_sexpr(args, 1);
        const m = nth_sexpr(args, 2);
        let code =
            interpret(ctx, n,               // n
            interpret(ctx, m,               // n m
            new_instr("cmp", "ge", k)));    // n>=m
        return code;
    }

    function xlat_gt_num(ctx, args, k) {
        const n = nth_sexpr(args, 1);
        const m = nth_sexpr(args, 2);
        let code =
            interpret(ctx, n,               // n
            interpret(ctx, m,               // n m
            new_instr("cmp", "gt", k)));    // n>m
        return code;
    }

    function xlat_add_num(ctx, args, k) {
        const n = nth_sexpr(args, 1);
        const m = nth_sexpr(args, 2);
        const n_const = constant_value(n);
        const m_const = constant_value(m);
        if (typeof n_const === "number"
        &&  typeof m_const === "number") {
            return new_instr("push", n_const + m_const);
        }
        if (n_const === 0) {
            return interpret(ctx, m, k);
        }
        if (m_const === 0) {
            return interpret(ctx, n, k);
        }
        let code =
            interpret(ctx, n,               // n
            interpret(ctx, m,               // n m
            new_instr("alu", "add", k)));   // n+m
        return code;
    }

    function xlat_sub_num(ctx, args, k) {
        const n = nth_sexpr(args, 1);
        const m = nth_sexpr(args, 2);
        const n_const = constant_value(n);
        const m_const = constant_value(m);
        if (typeof n_const === "number"
        &&  typeof m_const === "number") {
            return new_instr("push", n_const - m_const);
        }
        if (m_const === 0) {
            return interpret(ctx, n, k);
        }
        let code =
            interpret(ctx, n,               // n
            interpret(ctx, m,               // n m
            new_instr("alu", "sub", k)));   // n-m
        return code;
    }

    function xlat_mul_num(ctx, args, k) {
        const n = nth_sexpr(args, 1);
        const m = nth_sexpr(args, 2);
        const n_const = constant_value(n);
        const m_const = constant_value(m);
        if (typeof n_const === "number"
        &&  typeof m_const === "number") {
            return new_instr("push", n_const * m_const);
        }
        if (n_const === 1) {
            return interpret(ctx, m, k);
        }
        if (m_const === 1) {
            return interpret(ctx, n, k);
        }
        let code =
            interpret(ctx, n,               // n
            interpret(ctx, m,               // n m
            new_instr("alu", "mul", k)));   // n*m
        return code;
    }

    function xlat_not(ctx, args, k) {
        const value = nth_sexpr(args, 1);
        let code =
            interpret(ctx, value,           // value
            new_if_instr(
                new_instr("push", true_lit, k),
                new_instr("push", false_lit, k),
            ));
        return code;
    }

    function xlat_if(ctx, args, k) {
        const pred = nth_sexpr(args, 1);
        const cnsq = nth_sexpr(args, 2);
        const altn = nth_sexpr(args, 3);
        let code =
            interpret(ctx, pred,
            new_if_instr(
                interpret(ctx, cnsq, k),
                interpret(ctx, altn, k),
            ));
        return code;
    }

    const BEH_ctx = {
        number: xlat_literal,
        type: xlat_literal,
        literal: xlat_literal,
        string: function(ctx, crlf, k) {
            if (crlf === "SELF") {
                return new_instr("my", "self", k);  // SELF reference
            }
            return xlat_variable(ctx, crlf, k);
        },
        pair: xlat_invoke,
        func_map: Object.assign({
            "BEH": xlat_not_implemented,
            "SEND": xlat_SEND,
        }, prim_map),
        state_maps: [],
        msg_map: {}
    };

    function xlat_not_implemented(ctx, args, k) {
        return {
            error: "not implemented",
            crlf,
            ctx
        };
    }

    function interpret(ctx, crlf, k) {
        if (k?.error) {
            return k;
        }
        let transform;
        const type = typeof crlf;
        if (type !== "object") {
            transform = ctx[type];
        } else {
            const kind = crlf.kind;
            transform = ctx[kind];
        }
        if (typeof transform === "function") {
            // FIXME: this = ctx?
            return transform(ctx, crlf, k);
        }
        return {
            error: "no interpreter",
            crlf,
            ctx
        };
    }

    function interpret_seq(ctx, list, k) {
        if (k?.error) {
            return k;
        }
        if (equal_to(nil_lit, list)) {
            trace_log("interpret_seq () k:", k);
            return k;
        }
        if (list?.kind === "pair") {
            const head = list?.head;
            const tail = list?.tail;
            trace_log("interpret_seq (h . t) h:", head);
            let code =
                interpret(ctx, head,
                interpret_seq(ctx, tail, k));
            return code;
        }
        return {
            error: "list expected",
            body: list
        };
    }

    function interpret_args(ctx, list, k) {
        if (k?.error) {
            return k;
        }
        if (equal_to(nil_lit, list)) {
            trace_log("interpret_args () k:", k);
            return k;
        }
        if (list?.kind === "pair") {
            const head = list?.head;
            const tail = list?.tail;
            trace_log("interpret_args (h . t) h:", head);
            k = interpret(ctx, head, k);
            let code = interpret_args(ctx, tail, k);
            return code;
        }
        return {
            error: "list expected",
            body: list
        };
    }

    function interpret_lambda(ctx, args) {
        const ptrn = nth_sexpr(args, 1);
        const body = nth_sexpr(args, -1);
        debug_log("lambda:", "ptrn:", to_scheme(ptrn));
        debug_log("lambda:", "body:", to_scheme(body));
        const child = Object.assign({}, lambda_ctx);
        child.parent = ctx;
        if (ctx.state_maps) {
            child.state_maps = ctx.state_maps.slice();
        }
        if (ctx.msg_map) {
            child.state_maps.unshift(ctx.msg_map);  // add msg to lexically-captured state
        }
        debug_log("lambda:", "state_maps:", child.state_maps);
        child.msg_map = pattern_to_map(ptrn, 1);  // skip implicit customer
        debug_log("lambda:", "msg_map:", child.msg_map);
        if (body?.kind !== "pair") {
            // empty body
            let code =
                new_instr("push", unit_lit,
                std.cust_send);
            return code;
        }
        // sequential body
        let code =
            interpret_seq(child, body,
            std.cust_send);
        return code;
    }

    const sexprs = parse(source);
    if (sexprs.error) {
        return sexprs;
    }
    const ctx = Object.assign({}, module_ctx);
    // FIXME: could we use `interpret_seq()` instead? -- no, we don't have a sexpr list.
    let k =
        new_instr("msg", 0,             // {caps}
        new_instr("push", 2,            // {caps} dev.debug_key
        new_instr("dict", "get",        // debug_dev
        std.send_msg)));
    while (sexprs.length > 0) {
        const crlf = sexprs.pop(); //sexprs.shift();
        debug_log("compile:", to_scheme(crlf));
        k = interpret(ctx, crlf, k);
        if (k?.error) {
            return k;
        }
    }
    module_env["boot"] = k;
    return {
        lang: "uFork",
        ast: {
            kind: "module",
            import: {},
            define: module_env,
            export: [
                "boot"
            ]
        }
    };
}

/*
 * Translation tools
 */

function chain_to_list(chain) {
    let list = [];
    while (chain?.kind === "instr") {
        if (chain.op === "if") {
            return;  // branching breaks the chain
        }
        list.push(chain);
        chain = chain.k;
    }
    return list;
}

function join_instr_chains(t_chain, f_chain, j_label) {
    let t_list = chain_to_list(t_chain);
    if (!t_list) {
        return;
    }
    let f_list = chain_to_list(f_chain);
    if (!f_list) {
        return;
    }
    while (t_list.length > 0 && f_list.length > 0) {
        t_chain = t_list.pop();
        f_chain = f_list.pop();
        if (t_chain.op !== f_chain.op
        || !equal_to(t_chain.imm, f_chain.imm)) {
            break;
        }
    }
    const join = t_chain.k;
    const j_ref = new_ref(j_label);
    t_chain.k = j_ref;
    f_chain.k = j_ref;
    return join;
}

function is_asm_leaf(crlf) {
    if (typeof crlf === "object") {
        const kind = crlf?.kind;
        if (kind === "literal" || kind === "ref") {
            return true;
        }
        if (kind === "type") {
            return (typeof crlf.arity !== "number");
        }
        return false;
    }
    return true;
}
function to_asm(crlf) {
    if (typeof crlf === "string") {
        return crlf;
    }
    if (typeof crlf === "number") {
        return String(crlf);
    }
    let s = "";
    const kind = crlf?.kind;
    if (kind === "module") {
        asm_label = 1;
        for (const [name, value] of Object.entries(crlf.define)) {
            s += '"' + name + '"' + ":\n";
            if (is_asm_leaf(value)) {
                s += "    ref " + to_asm(value) + "\n";
            } else {
                s += to_asm(value);
            }
        }
        let exports = crlf?.export;
        if (exports) {
            s += ".export\n";
            for (const name of exports) {
                s += "    " + '"' + name + '"' + "\n";
            }
        }
    } else if (kind === "instr") {
        s += "    " + crlf.op;
        if (crlf.op === "if") {
            // generate labels for branch targets
            let t_label = "t~" + asm_label;
            let f_label = "f~" + asm_label;
            let j_label = "j~" + asm_label;
            asm_label += 1;
            s += " " + '"' + t_label + '"';
            s += " " + '"' + f_label + '"' + "\n";
            const join = join_instr_chains(crlf.t, crlf.f, j_label);
            s += '"' + t_label + '"' + ":\n";
            s += to_asm(crlf.t);
            s += '"' + f_label + '"' + ":\n";
            s += to_asm(crlf.f);
            if (join) {
                s += '"' + j_label + '"' + ":\n";
                s += to_asm(join);
            }
            return s;
        }
        if (crlf.op !== "debug") {
            if (is_asm_leaf(crlf.imm)) {
                s += " " + to_asm(crlf.imm);
            } else {
                // generate labels for immediate data
                let i_label = "i~" + asm_label;
                let k_label = "k~" + asm_label;
                asm_label += 1;
                s += " " + '"' + i_label + '"';
                s += " " + '"' + k_label + '"' + "\n";
                s += '"' + i_label + '"' + ":\n";
                s += to_asm(crlf.imm);
                s += '"' + k_label + '"' + ":\n";
                s += to_asm(crlf.k);
                return s;
            }
        }
        s += "\n";
        if (crlf.op !== "end") {
            if (is_asm_leaf(crlf.k)) {
                s += "    ref " + to_asm(crlf.k) + "\n";
            } else {
                s += to_asm(crlf.k);
            }
        }
    } else if (kind === "literal") {
        const name = crlf.value;
        if (name === "undef") {
            s += "#?";
        } else if (name === "nil") {
            s += "#nil";
        } else if (name === "false") {
            s += "#f";
        } else if (name === "true") {
            s += "#t";
        } else if (name === "unit") {
            s += "#unit";
        }
    } else if (kind === "type") {
        const arity = crlf.arity;
        if (typeof arity === "number") {
            s += "    type_t " + arity + "\n";
        } else {
            const name = crlf.name;
            if (typeof name === "string") {
                s += "#" + name + "_t";
            } else {
                s += "#unknown_t";
            }
        }
    } else if (kind === "pair") {
        s += "    pair_t ";
        if (is_asm_leaf(crlf.head)) {
            s += to_asm(crlf.head) + "\n";
            if (is_asm_leaf(crlf.tail)) {
                s += "    ref " + to_asm(crlf.tail) + "\n";
            } else {
                s += to_asm(crlf.tail);
            }
        } else {
            // generate labels for complex data
            let a_label = "a~" + asm_label;
            let d_label = "d~" + asm_label;
            asm_label += 1;
            s += '"' + a_label + '"' + " ";
            s += '"' + d_label + '"' + "\n";
            s += '"' + a_label + '"' + ":\n";
            s += to_asm(crlf.head);
            s += '"' + d_label + '"' + ":\n";
            s += to_asm(crlf.tail);
            return s;
        }
    } else if (kind === "dict") {
        s += "    dict_t ";
        if (!is_asm_leaf(crlf.key)) {
            return {
                error: "dict key must be asm leaf",
                crlf
            };
        }
        s += to_asm(crlf.key) + " ";
        if (is_asm_leaf(crlf.value)) {
            s += to_asm(crlf.value) + "\n";
            if (is_asm_leaf(crlf.next)) {
                s += "    ref " + to_asm(crlf.next) + "\n";
            } else {
                s += to_asm(crlf.next);
            }
        } else {
            // generate labels for complex data
            let v_label = "v~" + asm_label;
            let n_label = "n~" + asm_label;
            asm_label += 1;
            s += '"' + v_label + '"' + " ";
            s += '"' + n_label + '"' + "\n";
            s += '"' + v_label + '"' + ":\n";
            s += to_asm(crlf.value);
            s += '"' + n_label + '"' + ":\n";
            s += to_asm(crlf.next);
            return s;
        }
    } else if (kind === "ref") {
        const module = crlf.module;
        s += '"';
        if (typeof module === "string") {
            s += module + ".";
        }
        s += crlf.name;
        s += '"';
    } else if (kind === "quad") {
        let arity = (crlf.z === undefined)
            ? (crlf.y === undefined)
                ? (crlf.x === undefined)
                    ? 0
                    : 1
                : 2
            : 3;
        let x_is_leaf = is_asm_leaf(crlf.x);
        let y_is_leaf = is_asm_leaf(crlf.y);
        let z_is_leaf = is_asm_leaf(crlf.z);
        // generate labels for quad data fields
        let x_label = "x~" + asm_label;
        let y_label = "y~" + asm_label;
        let s = "    quad_" + (arity + 1) + " ";
        s += to_asm(crlf.t);
        let eos = "\n";
        if (arity > 0) {
            if (x_is_leaf) {
                s += " " + to_asm(crlf.x);
            } else if (arity === 1) {
                eos += to_asm(crlf.x);
                x_is_leaf = true;
            } else {
                s += ' "' + x_label + '"';
                if (y_is_leaf) {
                    s += " " + to_asm(crlf.y);
                } else if (arity === 2) {
                    eos += to_asm(crlf.y);
                    y_is_leaf = true;
                } else {
                    s += ' "' + y_label + '"';
                    if (z_is_leaf) {
                        s += " " + to_asm(crlf.z);
                    } else {
                        eos += to_asm(crlf.z);
                    }
                }
            }
        }
        s += eos;
        if (!x_is_leaf) {
            s += '"' + x_label + '"' + ":\n";
            s += to_asm(crlf.x);
        }
        if (!y_is_leaf) {
            s += '"' + y_label + '"' + ":\n";
            s += to_asm(crlf.y);
        }
        if (!x_is_leaf || !y_is_leaf) {
            asm_label += 1;  // all leaves? no labels.
        }
        return s;
    } else {
        return {
            error: "unknown asm",
            crlf
        }
    }
    return s;
}

export default Object.freeze({parse, compile});

const sample_source = `
(define memo_beh
    (lambda (value)
        (BEH (cust)
            (SEND cust value) )))`;
const fact_source = `
(define fact
    (lambda (n)
        (if (> n 1)
            (* n (fact (- n 1)))
            1)))`;
const ifact_source = `
(define ifact  ; fact(n) == ifact(n 1)
    (lambda (n a)
        (if (> n 1)
            (ifact (- n 1) (* a n))
            a)))`;
const fib_source = `
(define fib
    (lambda (n)
        (if (< n 2)
            n
            (+ (fib (- n 1)) (fib (- n 2))) )))`;
const hof2_source = `
(define hof2
    (lambda (x)
        (lambda (y z)
            (list x y z) )))`;
const hof3_source = `
(define hof3
    (lambda (x)
        (lambda (y z)
            (lambda q
                (list x y z q) ))))`;
const test_source = `
f n z
0
(define z 0)
1
(define n '(1 2 3))
2
(define f (lambda (x y) y))
3
(define length
    (lambda (x)
        (if (pair? x)
            (+ (length (cdr x)) 1)
            0) ))
z n f 'a 'foo
(length n)
(not z n)
(f n z)
'((a b) c)
`;

// const sexprs = parse(" `('foo (,bar ,@baz) . quux)\r\n");
// const sexprs = parse("(0 1 -1 #t #f #nil #? () . #unit)");
// const sexprs = parse("(if (< n 0) #f #t)");
// const sexprs = parse("(lambda (x . y) x)");
//debug const sexprs = parse("(define f (lambda (x y) y))\n(f 0)\n");
//debug info_log("sexprs:", sexprs);
//debug if (!sexprs.error) {
//debug     sexprs.forEach(function (sexpr) {
//debug         info_log("sexpr:", to_scheme(sexpr));
//debug     });
//debug }

// const module = compile("(define z 0)");
// const module = compile("(define foo 'bar)");
// const module = compile("(define foo '(bar baz . quux))");
// const module = compile("(define nop (lambda _))");
// const module = compile("(define list (lambda x x))");
// const module = compile("(define id (lambda (x) x))");
// const module = compile("(define id (lambda (x . y) x))");
//debug const module = compile("(define f (lambda (x y) y))");
// const module = compile("(define fn (lambda (x) 0 x y q.z))");  // NOTE: "q.z" is _not_ a valid identifier!
// const module = compile("(define w (lambda (f) (f f)))");
// const module = compile("(define Omega (lambda _ ((lambda (f) (f f)) (lambda (f) (f f))) ))");
// const module = compile("(define fn (lambda (x y z) (list z (cons y x)) (car q) (cdr q) ))");
// const module = compile("(define fn (lambda (x y z) (if (eq? 'x x) (list z y x) (cons y z)) ))");
// const module = compile("(define fn (lambda (x y) (list (cons 'x x) (cons 'y y)) '(x y z) ))");
// const module = compile("(define hof (lambda (foo) (lambda (bar) (lambda (baz) (list 'foo foo 'bar bar 'baz baz) )))) (hof 'a '(b c) '(d . e))");
// const module = compile("(define inc ((lambda (a) (lambda (b) (+ a b))) 1))");
// const module = compile(sample_source);
// const module = compile(ifact_source);
// const module = compile(fact_source);
// const module = compile(fib_source);
// const module = compile(hof2_source);
// const module = compile(hof3_source);
// const module = compile(test_source);
//debug info_log(JSON.stringify(module, undefined, 2));
//debug if (!module?.error) {
//debug     info_log(to_asm(module.ast));
//debug }
