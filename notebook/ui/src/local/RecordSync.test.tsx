// @vitest-environment jsdom
import {afterEach,expect,it} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {RecordSyncForm} from './RecordSync';
import {MEDIA_CARRY_MAX_MB} from '../../../shared/media-limits.mjs';

afterEach(cleanup);

it('explains which media private Git sync carries',()=>{
  render(<RecordSyncForm onError={()=>{}} onChange={()=>{}}/>);
  const explanation=screen.getByText(new RegExp(`Pictures and PDFs up to ${MEDIA_CARRY_MAX_MB} MB`));
  expect(explanation).toHaveTextContent('notebook/_media/');
  expect(explanation).toHaveTextContent('included in private Git sync');
  expect(explanation).toHaveTextContent('Keys, search databases and larger media stay outside Git');
});
