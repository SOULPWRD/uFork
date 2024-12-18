// A transport for testing the TCP device.

// It simulates a private network in memory. Latency is randomised.
// The 'flakiness' parameter, between 0 and 1, controls the propensity for
// network errors.

// This module was originally part of the WebSeif project, see
// https://github.com/jamesdiacono/WebSeif.

/*jslint browser */

import tcp_transport_demo from "./tcp_transport_demo.js";

function delay(callback) {
    setTimeout(callback, 50 * Math.random());
}

function pause() {
    return new Promise(delay);
}

function random_chunk_size() {
    return Math.floor(128 * Math.random());
}

function tcp_transport_mock(flakiness = 0) {
    let listeners = Object.create(null);

    function flake() {
        return Math.random() < flakiness;
    }

    function listen(
        address,
        on_open,
        on_receive,
        on_close
    ) {
        let connections = [];
        if (listeners[address] !== undefined) {
            throw new Error("Listen failed.");
        }
        listeners[address] = function make_connection(
            on_initiator_receive,
            on_initiator_close
        ) {
            let connection = Object.create(null);
            let queue = Promise.resolve();

            function enqueue(make_promise) {
                queue = queue.then(pause).then(make_promise);
                return queue;
            }

            function forget_connection() {
                connections = connections.filter(
                    (the_connection) => the_connection !== connection
                );
            }

            function simulate_failure(reason) {
                if (!connections.includes(connection)) {
                    return;
                }
                on_initiator_close(reason);
                on_close(connection, reason);
                return forget_connection();
            }

            connection.send = function (chunk) {
                if (!connections.includes(connection)) {
                    throw new Error("Could not send, closed.");
                }

                function consume(subchunk) {
                    if (!connections.includes(connection)) {
                        return;
                    }
                    if (flake()) {
                        return simulate_failure("Send failed.");
                    }
                    return on_initiator_receive(subchunk);
                }

// Slice up the chunk into subchunks, so that they arrive at different times.
// This simulates backpressure in a TCP stream.

                while (chunk.length > 0) {
                    const take = random_chunk_size();
                    const subchunk = chunk.slice(0, take);
                    chunk = chunk.slice(take);
                    enqueue(consume.bind(undefined, subchunk));
                }
                return pause(); // backpressure
            };
            connection.close = function () {
                if (!connections.includes(connection)) {
                    return;
                }
                on_initiator_close();
                return forget_connection();
            };
            connections.push(connection);
            on_open(connection);

// The caller gets back a connection object with the same signature as
// 'connection', but with functionality that makes sense from the initiating
// party's perspective.

            let initiator_closed = false;
            return Object.freeze({
                send: function receive_from_initiating_party(chunk) {
                    if (initiator_closed) {
                        throw new Error("Could not send, closed.");
                    }
                    function consume(subchunk) {
                        if (!connections.includes(connection)) {
                            return;
                        }
                        if (flake()) {
                            return simulate_failure("Receive failed.");
                        }
                        return on_receive(connection, subchunk);
                    }
                    while (chunk.length > 0) {
                        const take = random_chunk_size();
                        const subchunk = chunk.slice(0, take);
                        chunk = chunk.slice(take);
                        enqueue(consume.bind(undefined, subchunk));
                    }
                    return pause(); // backpressure
                },
                close: function close_from_initiating_party() {
                    initiator_closed = true;
                    delay(function () {
                        if (!connections.includes(connection)) {
                            return;
                        }
                        forget_connection();
                        return on_close(connection);
                    });
                }
            });
        };
        return function stop() {
            delete listeners[address];
            connections.forEach(function (connection) {
                connection.close();
            });
        };
    }

    function connect(
        address,
        on_open,
        on_receive,
        on_close
    ) {
        let closed = false;
        let connection;
        delay(function () {
            if (closed) {
                return;
            }
            if (flake() || listeners[address] === undefined) {
                return on_close(connection, "Connect failed.");
            }
            connection = listeners[address](
                function wrap_on_receive(chunk) {
                    if (!closed) {
                        return on_receive(connection, chunk);
                    }
                },
                function wrap_on_close(reason) {
                    if (!closed) {
                        return on_close(connection, reason);
                    }
                }
            );
            on_open(connection);
        });
        return function close() {
            closed = true;
            if (connection !== undefined) {
                connection.close();
            }
        };
    }

    return Object.freeze({listen, connect});
}

if (import.meta.main) {
    tcp_transport_demo(tcp_transport_mock(0), "bob");
}

export default Object.freeze(tcp_transport_mock);
