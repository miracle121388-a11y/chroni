export type TimelineInterval = {
  id: string;
  startMinutes: number;
  endMinutes: number;
};

export type TimelinePlacement = TimelineInterval & {
  lane: number;
  laneCount: number;
  group: number;
};

/** Assigns overlapping intervals to separate lanes while keeping adjacent work in one lane. */
export function layoutTimelineIntervals(intervals: TimelineInterval[]): TimelinePlacement[] {
  const sorted = intervals
    .filter((interval) => Number.isFinite(interval.startMinutes)
      && Number.isFinite(interval.endMinutes)
      && interval.endMinutes > interval.startMinutes)
    .sort((left, right) => left.startMinutes - right.startMinutes
      || right.endMinutes - left.endMinutes
      || left.id.localeCompare(right.id));
  const groups: TimelineInterval[][] = [];
  let groupEnd = Number.NEGATIVE_INFINITY;

  for (const interval of sorted) {
    if (!groups.length || interval.startMinutes >= groupEnd) {
      groups.push([]);
      groupEnd = interval.endMinutes;
    } else {
      groupEnd = Math.max(groupEnd, interval.endMinutes);
    }
    groups.at(-1)?.push(interval);
  }

  return groups.flatMap((group, groupIndex) => {
    const laneEnds: number[] = [];
    const assigned = group.map((interval) => {
      let lane = laneEnds.findIndex((endMinutes) => endMinutes <= interval.startMinutes);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = interval.endMinutes;
      return { ...interval, lane };
    });
    const laneCount = Math.max(1, laneEnds.length);
    return assigned.map((interval) => ({ ...interval, laneCount, group: groupIndex }));
  });
}
