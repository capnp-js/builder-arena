/* @flow */

import test from "ava";
import { Unlimited } from "@capnp-js/base-arena";

import { Builder } from "../../src/index";

test("instantiation widens for root", t => {
  const arena = Builder.fresh(0, new Unlimited());

  t.is(arena.segment(0).end, 8);
});

test("`getRoot`", t => {
  t.plan(1);

  const arena = Builder.fresh(0, new Unlimited());

  const root = arena.getRoot();

  t.is(root, null);
});

test("`allocate`", t => {
  t.plan(8);

  const arena = Builder.fresh(128, new Unlimited());

  const alloc1 = arena.allocate(24);
  t.is(alloc1.position, 8);
  t.is(alloc1.segment.end, 32);

  const alloc2 = arena.allocate(96);
  t.is(alloc2.position, 32);
  t.is(alloc2.segment.end, 128);

  const alloc3 = arena.allocate(16);
  t.is(alloc3.position, 0);
  t.is(alloc3.segment.end, 16);

  const alloc4 = arena.allocate(512);
  t.is(alloc4.position, 0);
  t.is(alloc4.segment.end, 512);
});

test("`preallocate`", t => {
  t.plan(5);

  const arena = Builder.fresh(24, new Unlimited());

  const prealloc1 = arena.preallocate(24, arena.segment(0));
  t.is(prealloc1.position, 8);
  t.is(prealloc1.segment.end, 32);

  const prealloc2 = arena.preallocate(16, arena.segment(0));
  t.is(prealloc2.segment.id, 1);
  t.is(prealloc2.position, 8);
  t.is(prealloc2.segment.end, 24);
});

test("`write`", t => {
  t.plan(512);

  let i;
  const arena = Builder.fresh(504, new Unlimited());
  arena.allocate(504);

  for (i=0; i<256; ++i) {
    arena.segment(0).raw[i] = i;
    arena.segment(0).raw[i+256] = i;
  }

  const source = {
    segment: arena.segment(0),
    position: 129,
  };
  const target = {
    segment: arena.segment(0),
    position: 387,
  };
  arena.write(source, 31, target);

  for (let i=0; i<256; ++i) {
    if (387-256 <= i && i < 387-256+31) {
      t.is(arena.segment(0).raw[i], i);
      t.is(arena.segment(0).raw[i+256], i-(387-256)+129);
    } else {
      t.is(arena.segment(0).raw[i], i);
      t.is(arena.segment(0).raw[i+256], i);
    }
  }
});

test("`zero`", t => {
  t.plan(16);

  let i;
  const arena = Builder.fresh(24, new Unlimited());
  const alloc = arena.allocate(16);
  for (i=8; i<24; ++i) {
    alloc.segment.raw[i] = i;
  }
  arena.zero(alloc, 16);

  for (i=8; i<24; ++i) {
    t.is(alloc.segment.raw[i], 0);
  }
});
