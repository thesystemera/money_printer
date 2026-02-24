export const getUniqueDays = (data) => {
  if (!data || data.length === 0) return 0;
  const uniqueDays = new Set(data.map(item => item.date.split(' ')[0]));
  return uniqueDays.size;
};

const calculateNiceTickInterval = (min, max, maxTicks = 6) => {
  if (min === max) return 1;
  const range = max - min;
  const roughInterval = range / (maxTicks - 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughInterval)));
  const normalizedInterval = roughInterval / magnitude;

  let niceInterval;
  if (normalizedInterval <= 1) niceInterval = 1;
  else if (normalizedInterval <= 2) niceInterval = 2;
  else if (normalizedInterval <= 5) niceInterval = 5;
  else niceInterval = 10;

  return niceInterval * magnitude;
};

export const calculateNiceTicks = (data, key, forceZero = false, maxTicks = 6) => {
  if (!data || data.length === 0) return [];

  const values = (key ? data.map(d => d && d[key]) : data)
    .filter(v => v !== null && v !== undefined);

  if (values.length === 0) return [];

  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const min = forceZero ? 0 : dataMin;
  const max = dataMax;

  const interval = calculateNiceTickInterval(min, max, maxTicks);
  const ticks = [];

  const start = Math.floor(min / interval) * interval;
  const end = Math.ceil(max / interval) * interval;

  if (start === end) return [start];

  for (let tick = start; tick <= end; tick += interval) {
    ticks.push(tick);
  }

  return ticks;
};