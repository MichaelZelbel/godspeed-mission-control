import {Link} from 'react-router-dom';
import {ArrowLeft} from 'lucide-react';
import {MenerioImportCard} from '@/components/settings/MenerioImportCard';
export default function ImportMenerio(){
  return <div className="max-w-3xl space-y-6"><Link to="/dashboard/settings" className="inline-flex items-center gap-2 min-h-11 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden="true"/>Back to settings</Link><h1 className="text-2xl font-semibold">Bring your knowledge with you</h1><MenerioImportCard/></div>;
}
