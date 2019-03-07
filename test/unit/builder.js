/* @flow */

import * as assert from "assert";
import { describe, it } from "mocha";
import { Unlimited } from "@capnp-js/base-arena";
import { get, set } from "@capnp-js/bytes";

import { Builder } from "../../src/index";

describe("Builder", function () {
  it("`fresh` construction leaves space for the root word", function () {
    const arena = Builder.fresh(0, new Unlimited());

    assert.equal(arena.segment(0).end, 8);
  });

  describe(".getRoot", function () {
    it("returns null after `fresh` construction", function () {
      const arena = Builder.fresh(0, new Unlimited());
      const root = arena.getRoot();
      assert.equal(root, null);
    });
  });

  describe(".allocate", function () {
    const arena = Builder.fresh(128, new Unlimited());

    it("moves `end` within the same segment while there exists sufficient space", function () {
      const alloc1 = arena.allocate(24);
      assert.equal(alloc1.position, 8);
      assert.equal(alloc1.segment.end, 32);

      const alloc2 = arena.allocate(104);
      assert.equal(alloc2.position, 32);
      assert.equal(alloc2.segment.end, 136);
    });

    it("creates a new segment when insufficient space exists", function () {
      assert.ok(arena.segment(0).raw.length - arena.segment(0).end < 16);

      const alloc3 = arena.allocate(16);
      assert.equal(alloc3.segment.id, 1);
      assert.equal(alloc3.position, 0);
      assert.equal(alloc3.segment.end, 16);

      assert.ok(arena.segment(1).raw.length - arena.segment(0).end < 512);
      const alloc4 = arena.allocate(512);
      assert.equal(alloc4.segment.id, 2);
      assert.equal(alloc4.position, 0);
      assert.equal(alloc4.segment.end, 512);
    });
  });

  describe(".preallocate", function () {
    const arena = Builder.fresh(24, new Unlimited());

    it("moves `end` within the same segment while there exists sufficient space", function () {
      const prealloc1 = arena.preallocate(24, arena.segment(0));
      assert.equal(prealloc1.segment.id, 0);
      assert.equal(prealloc1.position, 8);
      assert.equal(prealloc1.segment.end, 32);
    });

    it("creates a new segment when insufficient space exists", function () {
      assert.ok(arena.segment(0).raw.length - arena.segment(0).end < 16);
      const prealloc2 = arena.preallocate(16, arena.segment(0));
      assert.equal(prealloc2.segment.id, 1);
      assert.equal(prealloc2.position, 8);
      assert.equal(prealloc2.segment.end, 24);
    });
  });

  describe(".write", function () {
    const arena = Builder.fresh(504, new Unlimited());

    it("transfers bytes from source to target", function () {
      arena.allocate(504);

      for (let i=0; i<256; ++i) {
        set(i, i, arena.segment(0).raw);
        set(i, i+256, arena.segment(0).raw);
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
          assert.equal(get(i, arena.segment(0).raw), i);
          assert.equal(get(i+256, arena.segment(0).raw), i-(387-256)+129);
        } else {
          assert.equal(get(i, arena.segment(0).raw), i);
          assert.equal(get(i+256, arena.segment(0).raw), i);
        }
      }
    });
  });

  describe(".zero", function () {
    const arena = Builder.fresh(24, new Unlimited());

    it("zeros bytes", function () {
      let i;

      const alloc = arena.allocate(16);
      for (i=8; i<24; ++i) {
        set(i, i, alloc.segment.raw);
      }
      arena.zero(alloc, 16);

      for (i=8; i<24; ++i) {
        assert.equal(get(i, alloc.segment.raw), 0);
      }
    });
  });
});

describe("Pointer Copying", function () {
  //text formatted inputs
  //expected value: output canonical form
  //actual value: output segmented binary for my library to intern, then copy to another arena, then pipe that through the reference implementation to canonical form



});
