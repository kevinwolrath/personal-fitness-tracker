import { nextRecordedAt } from '../recordedAt';
import { observation } from '../../../fixtures/gamification/journey';

it('keeps rapid corrected measurements ordered through reloads and fixed clocks',()=>{
  const now=new Date('2026-11-02T09:00:00Z');
  const a={...observation('weight',100,'2026-11-02'),recordedAt:nextRecordedAt(now,[])};
  const b={...a,id:'second',value:99,recordedAt:nextRecordedAt(now,[a])};
  expect(b.recordedAt).toBe('2026-11-02T09:00:00.001Z');
  expect(nextRecordedAt(now,[a,b])).toBe('2026-11-02T09:00:00.002Z');
  expect(nextRecordedAt(now,[{...a,recordedAt:'2026-11-02T20:00:00+11:00'}])).toBe(b.recordedAt);
});
