// uFork device interfaces

use crate::*;

pub struct ClockDevice {
    pub read_clock: fn() -> Any,
}
impl Default for ClockDevice {
    fn default() -> Self {
        Self {
            read_clock: || Any::new(0),
        }
    }
}
impl Device for ClockDevice {
    fn handle_event(&mut self, core: &mut Core, ep: Any) -> Result<(), Error> {
        let event = core.mem(ep);
        let sponsor = event.t();
        let cust = event.y();  // cust
        let now = (self.read_clock)();
        let evt = core.reserve_event(sponsor, cust, now)?;
        core.event_enqueue(evt);
        Ok(())  // event handled.
    }
}

pub struct RandomDevice {
    pub get_random: fn(Any, Any) -> Any,
}
impl Default for RandomDevice {
    fn default() -> Self {
        Self {
            get_random: |_, _| Any::new(0),
        }
    }
}
impl Device for RandomDevice {
    fn handle_event(&mut self, core: &mut Core, ep: Any) -> Result<(), Error> {
        let event = core.mem(ep);
        let sponsor = event.t();
        let msg = event.y();  // cust | (cust . limit) | (cust a . b)
        let cust = if msg.is_cap() {
            msg
        } else {
            core.nth(msg, PLUS_1)
        };
        let limit = core.nth(msg, MINUS_1);
        let a = core.nth(msg, PLUS_2);
        let b = core.nth(msg, MINUS_2);
        let random = if msg.is_cap() {
            (self.get_random)(UNDEF, UNDEF)
        } else if limit.is_fix() {
            (self.get_random)(limit, UNDEF)
        } else {
            (self.get_random)(a, b)
        };
        let evt = core.reserve_event(sponsor, cust, random)?;
        core.event_enqueue(evt);
        Ok(())  // event handled.
    }
}

pub struct IoDevice {
    pub write: fn (code: Any) -> Any,
    pub read: fn (stub: Any) -> Any,
}
impl Default for IoDevice {
    fn default() -> Self {
        Self {
            write: |_| Any::fix(E_OK as isize),
            read: |_| UNDEF,
        }
    }
}

/*
    The `IoDevice` interface is described in io_dev.md.
*/
impl Device for IoDevice {
    fn handle_event(&mut self, core: &mut Core, ep: Any) -> Result<(), Error> {
        let event = core.mem(ep);
        let sponsor = event.t();
        let dev = event.x();
        let msg = event.y();  // (to_cancel callback . #?) | (to_cancel callback . fixnum)
        if core.typeq(PAIR_T, msg) {
            let _to_cancel = core.nth(msg, PLUS_1);
            // FIXME: cancel option not implemented
            let callback = core.nth(msg, PLUS_2);
            if !callback.is_cap() {
                return Err(E_NOT_CAP);
            }
            let data = core.nth(msg, MINUS_2);
            if data == UNDEF {  // (to_cancel callback . #?)
                // read request
                let evt = core.reserve_event(sponsor, callback, UNDEF)?;
                let stub = core.reserve_stub(dev, evt)?;
                let char = (self.read)(stub);
                if char.is_fix() {
                    // if `read` was synchronous, reply immediately
                    let result = core.reserve(&Quad::pair_t(TRUE, char))?;  // (#t . char)
                    core.ram_mut(evt).set_y(result);  // msg = result
                    core.event_enqueue(evt);
                    core.release_stub(stub);
                }
            } else if data.is_fix() {  // (to_cancel callback . fixnum)
                // write request
                (self.write)(data);
                // in the current implementation, `write` is synchronous, so we reply immediately
                let result = core.reserve(&Quad::pair_t(TRUE, UNDEF))?;  // (#t . #?)
                let evt = core.reserve_event(sponsor, callback, result)?;
                core.event_enqueue(evt);
            }
        }
        // NOTE: unrecognized messages may be ignored
        Ok(())  // event handled.
    }
}

pub struct TimerDevice {
    pub start_timer: fn(Any, Any),
    pub stop_timer: fn(Any) -> bool,
}
impl Default for TimerDevice {
    fn default() -> Self {
        Self {
            start_timer: |_,_| (),
            stop_timer: |_| false,
        }
    }
}
impl Device for TimerDevice {
    fn handle_event(&mut self, core: &mut Core, ep: Any) -> Result<(), Error> {
        let event = core.mem(ep);
        let sponsor = event.t();
        let dev = event.x();
        let msg = event.y();
        let ptr = core.cap_to_ptr(dev);
        let myself = core.ram(ptr);
        if myself.t() == PROXY_T {
            // stop timer request
            let handle = myself.y();
            if handle.is_ram() {
                if (self.stop_timer)(handle) {
                    core.release_stub(handle);
                }
                core.ram_mut(ptr).set_y(UNDEF);
            }
        } else {
            // start timer request
            let arg_1 = core.nth(msg, PLUS_1);
            if arg_1.is_fix() {  // simple delayed message
                // (delay target . message)
                let delay = arg_1;
                let target = core.nth(msg, PLUS_2);
                if !target.is_cap() {
                    return Err(E_NOT_CAP);
                }
                let message = core.nth(msg, MINUS_2);
                let delayed = Quad::new_event(sponsor, target, message);
                let ptr = core.reserve(&delayed)?;
                let stub = core.reserve_stub(dev, ptr)?;
                (self.start_timer)(delay, stub);
            } else {  // requestor-style interface
                // (to_cancel callback delay . result)
                let to_cancel = arg_1;
                let callback = core.nth(msg, PLUS_2);
                if !callback.is_cap() {
                    return Err(E_NOT_CAP);
                }
                let delay = core.nth(msg, PLUS_3);
                if !delay.is_fix() {
                    return Err(E_NOT_FIX);
                }
                let result = core.nth(msg, MINUS_3);
                let delayed = Quad::new_event(sponsor, callback, result);
                let ptr = core.reserve(&delayed)?;
                let stub = core.reserve_stub(dev, ptr)?;
                (self.start_timer)(delay, stub);
                if to_cancel.is_cap() {
                    let proxy = core.reserve_proxy(dev, stub)?;
                    let evt = core.reserve_event(sponsor, to_cancel, proxy)?;
                    core.event_enqueue(evt);
                }
            }
        }
        Ok(())  // event handled.
    }
}

pub struct HostDevice {
    pub to_host: fn(Any) -> Error,
}
impl Default for HostDevice {
    fn default() -> Self {
        Self {
            to_host: |_| E_OK,
        }
    }
}
impl Device for HostDevice {
    fn handle_event(&mut self, core: &mut Core, ep: Any) -> Result<(), Error> {
        let event = core.mem(ep);
        let device = event.x();
        let event_stub = core.reserve_stub(device, ep)?;
        match (self.to_host)(event_stub) {
            E_OK => Ok(()),
            code => {
                core.release_stub(event_stub);
                Err(code)
            }
        }
    }
    fn drop_proxy(&mut self, _core: &mut Core, proxy: Any) {
        (self.to_host)(proxy);
    }
}
