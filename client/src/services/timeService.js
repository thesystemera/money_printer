let TIME_STATE = {
  enableTimeOverride: false,
  overrideDateTime: null
};

export const getCurrentTime = () => {
  if (TIME_STATE.enableTimeOverride && TIME_STATE.overrideDateTime) {
    try {
      const overrideTime = new Date(TIME_STATE.overrideDateTime);
      if (!isNaN(overrideTime.getTime())) {
        return overrideTime;
      }
    } catch (e) {
      console.error('[TIME ERROR]', e);
    }
  }
  return new Date();
};

export const getTimestamp = () => {
  return getCurrentTime().getTime();
};

export const setTimeOverride = (enabled, dateTime = null) => {
  TIME_STATE = {
    enableTimeOverride: !!enabled,
    overrideDateTime: dateTime
  };

  console.log(`[TIME] Time override ${enabled ? 'enabled' : 'disabled'}${dateTime ? ` with date: ${new Date(dateTime).toLocaleString()}` : ''}`);
};

export const getTimeState = () => {
  return { ...TIME_STATE };
};