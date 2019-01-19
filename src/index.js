/* @flow */

import type { Limiter } from "@capnp-js/base-arena";
import type {
  Byte,
  SegmentLookup,
  SegmentR,
  SegmentB,
  Word,
} from "@capnp-js/memory";
import type {
  ArenaB,
  UserArenaB,
  ReaderCtor,
  StructCtorB,
  ListCtorB,
} from "@capnp-js/builder-core";
import type {
  StructGutsR,
  BoolListGutsR,
  NonboolListGutsR,
  StructValue as StructValueR,
  Data as DataR,
  Text as TextR,
} from "@capnp-js/reader-core";

import { Base, Limited } from "@capnp-js/base-arena";
import {
  Orphan,
  StructValue,
  Data,
  Text,
  initStruct,
} from "@capnp-js/builder-core";
import { nonboolListTag } from "@capnp-js/copy-pointers";
import {
  structHi,
  boolListHi,
  nonboolListHi,
  wordAligned,
} from "@capnp-js/layout";
import { root } from "@capnp-js/memory";
import { encode, stringBytes } from "@capnp-js/utf8";

type uint = number;
type u29 = number;
type u30 = number;

export class Builder extends Base<SegmentB> implements SegmentLookup<SegmentB>, ArenaB, UserArenaB {
  +segments: Array<SegmentB>;
  nextSize: uint;

  static limited(segments: Array<SegmentB>, maxBytes: uint, maxLevel: uint): this {
    return new this(segments, new Limited(maxBytes, maxLevel));
  }

  //TODO: Move Unlimited from reader-arena to base-arena
  static fresh(bytes: uint, limiter: Limiter): this {
    bytes += 8;
    const raw = new Uint8Array(bytes);
    return new this([{id: 0, raw, end: 8}], limiter);
  }

  //TODO: impose word aligned bytes with bytes >= 8 precondition in comment(s)
  //TODO: Throw on bad inputs?
  constructor(segments: Array<SegmentB>, limiter: Limiter) {
    super(segments, limiter);
    this.nextSize = wordAligned.bytes(1.5 * segments[0].raw.length);
  }

  malloc(length: uint): {| +segment: SegmentB, position: uint |} {
    /* Quick and dirty. Look for space on the newest segment, and create a new
       segment if the newest segment has insufficient space. */

    {
      const segment = this.segments[this.segments.length - 1];
      const position = segment.end;
      if (position + length <= segment.raw.length) {
        segment.end += length;
        return {
          segment,
          position,
        };
      }
    }

    /* No segment contained sufficient space, so create a new segment. */
    {
      if (this.nextSize < length) {
        this.nextSize = length;
      }

      const segment = {
        id: this.segments.length,
        raw: new Uint8Array(this.nextSize),
        end: length,
      };
      this.segments.push(segment);
      this.nextSize = wordAligned.bytes(1.5 * this.nextSize);

      return {
        segment,
        position: 0,
      };
    }
  }

  //TODO: return type becomes Word<SegmentB> (check types to be sure nothing breaks).
  allocate(length: uint, bias?: SegmentB): Word<SegmentB> {
    if (bias) {
      const oldEnd = bias.end;
      if (oldEnd + length <= bias.raw.length) {
        bias.end += length;
        return {
          segment: bias,
          position: oldEnd,
        };
      }
    }

    return this.malloc(length);
  }

  //TODO: Refactor return type to specific type from builder/type.js
  preallocate(length: uint, local: SegmentB): Word<SegmentB> {
    const oldEnd = local.end;
    if (oldEnd + length <= local.raw.length) {
      local.end += length;

      return {
        segment: local,
        position: oldEnd,
      };
    }

    /* There's insufficient space for `length` bytes on the `local` segment, so
       allocate `length` bytes and a far pointer landing pad on some other
       segment. */
    const land = this.malloc(8 + length);
    land.position += 8;

    return land;
  }

  write(source: Byte<SegmentR>, length: uint, target: Byte<SegmentB>): void {
    //TODO: Call raw's `set` method here instead of the loop
    let s = source.position;
    let t = target.position;
    const end = t + length;
    for (; t<end; ++s, ++t) {
      target.segment.raw[t] = source.segment.raw[s];
    }
  }

  zero(begin: Byte<SegmentB>, length: uint): void {
    begin.segment.raw.fill(0, begin.position, begin.position + length);
  }

  initRoot<R: {+guts: StructGutsR}, B: ReaderCtor<StructGutsR, R>>(Ctor: StructCtorB<R, B>): B {
    const guts = initStruct(0, this, root(this), Ctor.compiledBytes());
    return Ctor.intern(guts);
  }

  getRoot(): null | StructValue {
    return StructValue.get(0, this, root(this));
  }

  setRoot(value: StructValueR | StructValue): void {
    value.guts.set(0, this, root(this)); //TODO: Document how builder arenas must have an initial root word
  }

  disownRoot(): null | Orphan<StructGutsR, StructValueR, StructValue> {
    return StructValue.disown(0, this, root(this));
  }

  adoptRoot(orphan: Orphan<StructGutsR, StructValueR, StructValue>): void {
    orphan.guts.adopt(this, root(this));
  }

  //TODO: Test this method
  initStruct<R: {+guts: StructGutsR}, B: ReaderCtor<StructGutsR, R>>(
    Ctor: StructCtorB<R, B>,
    bias?: SegmentB,
  ): Orphan<StructGutsR, R, B> {
    const bytes = Ctor.compiledBytes();
    const wordAlignedLength = wordAligned.bytes(bytes.data + bytes.pointers);
    const object = this.allocate(wordAlignedLength, bias); //TODO: Refactor preallocate to share the parameter ordering with allocate? Rename preallocate's `local` to `bias`?
    return new Orphan(Ctor, this, {
      typeBits: 0x00,
      hi: structHi(bytes),
      object,
    });
  }

  //TODO: Test this method
  initList<GUTS: BoolListGutsR | NonboolListGutsR, R: {+guts: GUTS}, B: ReaderCtor<GUTS, R>>(
    Ctor: ListCtorB<GUTS, R, B>,
    length: u29 | u30,
    bias?: SegmentB,
  ): Orphan<GUTS, R, B> {
    const encoding = Ctor.encoding();
    if (encoding === null) {
      const wordAlignedLength = wordAligned.boolListBytes(length);
      const object = this.allocate(wordAlignedLength, bias);
      return new Orphan(Ctor, this, {
        typeBits: 0x01,
        hi: boolListHi(length),
        object,
      });
    } else {
      const wordAlignedLength = wordAligned.nonboolListBytes(length, encoding);
      const object = this.allocate(wordAlignedLength, bias);

      if (encoding.flag === 0x07) {
        /* TODO: This boolean test occurs here and again under `nonboolListHi`.
           The redundancy annoys me. */
        nonboolListTag(object, length, encoding.bytes);
      }

      return new Orphan(Ctor, this, {
        typeBits: 0x01,
        hi: nonboolListHi(encoding, length),
        object, //TODO: Does this need to get incremented by 8? Add tests to verify that it's working properly.
      });
    }
  }

  //TODO: Test this
  initText(
    ucs2: string,
    bias?: SegmentB,
  ): Orphan<NonboolListGutsR, TextR, Text> {
    /* Grab an extra byte for the null terminator. */
    const length = stringBytes(ucs2) + 1;
    const object = this.allocate(wordAligned.bytes(length), bias);
    encode(
      ucs2,
      object.segment.raw.subarray(object.position, object.position + length - 1),
    );
    const p = {
      typeBits: 0x01,
      hi: 0x02 | (length << 3),
      object,
    };

    return new Orphan(Text, this, p);
  }

  //TODO: Test this
  initData(
    length: u29,
    bias?: SegmentB,
  ): Orphan<NonboolListGutsR, DataR, Data> {
    /* Method `initList` can perform this, but it has been included explicitly
       for symmetry with `initText`. */
    const wordAlignedLength = wordAligned.bytes(length);
    const object = this.allocate(wordAlignedLength, bias);
    const p = {
      typeBits: 0x01,
      hi: 0x02 | (length << 3),
      object,
    };

    return new Orphan(Data, this, p);
  }
}
