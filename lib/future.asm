;;;
;;; single-assignment data-flow variable
;;;

.import
    std: "./std.asm"
    lib: "./lib.asm"
    dev: "./dev.asm"

;;  (define future-beh
;;      (lambda (rcap wcap)
;;          (BEH (tag . arg)
;;              (cond
;;                  ((eq? tag rcap)
;;                      (BECOME (wait-beh (list arg) rcap wcap)))
;;                  ((eq? tag wcap)
;;                      (BECOME (value-beh rcap arg))) ))))
beh:
future_beh:                 ; rcap,wcap <- tag,arg
    msg 1                   ; tag
    state 1                 ; tag rcap
    cmp eq                  ; tag==rcap
    if_not future_1         ; --
future_0:
    state 0                 ; rcap,wcap
    push #nil               ; rcap,wcap #nil
    msg -1                  ; rcap,wcap #nil cust=arg
    pair 1                  ; rcap,wcap waiting=cust,#nil
    pair 1                  ; waiting,rcap,wcap
    push wait_beh           ; waiting,rcap,wcap wait-beh
    actor become            ; --
    ref std.commit
future_1:
    msg 1                   ; tag
    state -1                ; tag wcap
    cmp eq                  ; tag==wcap
    if_not std.abort        ; --
future_2:
    msg -1                  ; value=arg
    state 1                 ; value rcap
    pair 1                  ; rcap,value
    push value_beh          ; rcap,value value-beh
    actor become            ; --
    ref std.commit

;;  (define wait-beh
;;      (lambda (waiting rcap wcap)
;;          (BEH (tag . arg)
;;              (cond
;;                  ((eq? tag rcap)
;;                      (BECOME (wait-beh (cons arg waiting) rcap wcap)))
;;                  ((eq? tag wcap)
;;                      (send-to-all waiting arg)
;;                      (BECOME (value-beh rcap arg))) ))))
wait_beh:                   ; waiting,rcap,wcap <- tag,arg
    msg 1                   ; tag
    state 2                 ; tag rcap
    cmp eq                  ; tag==rcap
    if_not wait_1           ; --
wait_0:
    state 0                 ; waiting,rcap,wcap
    part 1                  ; rcap,wcap waiting
    msg -1                  ; rcap,wcap waiting cust=arg
    pair 1                  ; rcap,wcap waiting'=cust,waiting
    pair 1                  ; waiting',rcap,wcap
    push wait_beh           ; waiting',rcap,wcap wait-beh
    actor become            ; --
    ref std.commit
wait_1:
    msg 1                   ; tag
    state -2                ; tag wcap
    cmp eq                  ; tag==wcap
    if_not std.abort        ; --
    state 1                 ; waiting
wait_2:
    dup 1                   ; waiting waiting
    typeq #pair_t           ; waiting is_pair(waiting)
    if_not wait_4           ; waiting
wait_3:
    part 1                  ; rest first
    msg -1                  ; rest first value=arg
    roll 2                  ; rest value=arg first
    actor send              ; waiting=rest
    ref wait_2
wait_4:
    msg -1                  ; waiting value=arg
    state 2                 ; waiting value rcap
    pair 1                  ; waiting rcap,value
    push value_beh          ; waiting rcap,value value-beh
    actor become            ; waiting
    ref std.commit

;;  (define value-beh
;;      (lambda (rcap value)
;;          (BEH (tag . arg)
;;              (cond
;;                  ((eq? tag rcap)
;;                      (SEND arg value))) )))
value_beh:                  ; rcap,value <- tag,arg
    msg 1                   ; tag
    state 1                 ; tag rcap
    cmp eq                  ; tag==rcap
    if_not std.abort        ; --
    state -1                ; value
    msg -1                  ; value cust=arg
    ref std.send_msg

; unit test suite
boot:                       ; _ <- {caps}
    push 1                  ; wcap
    push 0                  ; wcap rcap
    pair 1                  ; rcap,wcap
    push future_beh         ; rcap,wcap future-beh
    actor create            ; future.rcap,wcap
    msg 0                   ; future {caps}
    push dev.debug_key      ; future {caps} dev.debug_key
    dict get                ; future debug_dev

    push 42                 ; future debug_dev 42
    push 1                  ; future debug_dev 42 wcap
    pair 1                  ; future debug_dev wcap,42
    pick 3                  ; future debug_dev wcap,42 future
    actor send              ; future debug_dev

    push -1                 ; future debug_dev -1
    pick 2                  ; future debug_dev -1 debug_dev
    pair 1                  ; future debug_dev debug_dev,-1
    push lib.label_beh      ; future debug_dev debug_dev,-1 label-beh
    actor create            ; future debug_dev label-1=label-beh.debug_dev,-1
    push 0                  ; future debug_dev label-1 rcap
    pair 1                  ; future debug_dev rcap,label-1
    pick 3                  ; future debug_dev rcap,label-1 future
    actor send              ; future debug_dev

    push -2                 ; future debug_dev -2
    pick 2                  ; future debug_dev -2 debug_dev
    pair 1                  ; future debug_dev debug_dev,-2
    push lib.label_beh      ; future debug_dev debug_dev,-2 label-beh
    actor create            ; future debug_dev label-2=label-beh.debug_dev,-2
    push 0                  ; future debug_dev label-2 rcap
    pair 1                  ; future debug_dev rcap,label-2
    pick 3                  ; future debug_dev rcap,label-2 future
    actor send              ; future debug_dev

    ref std.commit

.export
    beh
    boot
