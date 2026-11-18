import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {busyServerMessage,startupRequest} from './startup-request';

describe('initial signed-in request during startup',()=>{
  const response=(ok:boolean)=>({ok}) as Response;
  let timeout:ReturnType<typeof vi.spyOn>;

  beforeEach(()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-17T12:00:00Z'));
    timeout=vi.spyOn(AbortSignal,'timeout').mockImplementation(()=>new AbortController().signal);
  });
  afterEach(()=>{vi.unstubAllGlobals();timeout.mockRestore();vi.useRealTimers();});

  it('returns a successful first response without checking readiness',async()=>{
    const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);
    const operation=vi.fn().mockResolvedValue(response(true));
    expect(await startupRequest(operation)).toEqual(response(true));
    expect(operation).toHaveBeenCalledOnce();expect(fetchMock).not.toHaveBeenCalled();expect(timeout).toHaveBeenCalledWith(15000);
  });

  it('returns an HTTP failure without retrying it',async()=>{
    const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);
    const failed=response(false),operation=vi.fn().mockResolvedValue(failed);
    expect(await startupRequest(operation)).toBe(failed);
    expect(operation).toHaveBeenCalledOnce();expect(fetchMock).not.toHaveBeenCalled();
  });

  it('polls until ready and retries the rejected request once',async()=>{
    const fetchMock=vi.fn().mockResolvedValueOnce(response(false)).mockResolvedValueOnce(response(true));vi.stubGlobal('fetch',fetchMock);
    const recovered=response(true),operation=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(recovered);
    const result=startupRequest(operation);await vi.advanceTimersByTimeAsync(250);
    expect(await result).toBe(recovered);expect(fetchMock).toHaveBeenCalledTimes(2);expect(operation).toHaveBeenCalledTimes(2);
    expect(timeout.mock.calls.filter(([milliseconds])=>milliseconds===15000)).toHaveLength(2);
  });

  it('stops after the readiness deadline',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response(false)));
    const result=startupRequest(vi.fn().mockRejectedValue(new Error('offline')));
    const rejection=expect(result).rejects.toThrow(busyServerMessage);
    await vi.advanceTimersByTimeAsync(15000);await rejection;
  });

  it('uses the busy message when the single retry rejects',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response(true)));
    const operation=vi.fn().mockRejectedValue(new Error('offline'));
    await expect(startupRequest(operation)).rejects.toThrow(busyServerMessage);
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
