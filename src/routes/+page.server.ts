import { marked } from 'marked';
import projectsMarkdown from '$lib/projects.md?raw';
import publicationsMarkdown from '$lib/publications.md?raw';   // <-- new import

interface Project {
    title: string;
    urls: Array<{ url: string; icon: string }>;
    description: string;
    tech: string;
    date: string;
    views?: string;
    downloads?: string;
}

// ─── same parser, works for both ───
function parseProjectsFromMarkdown(markdown: string): Project[] {
    const projects: Project[] = [];
    const lines = markdown.split('\n');
    let currentProject: Project | null = null;
    let collectingUrls = false;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        if (line.startsWith('## ') && !line.startsWith('# ')) {
            if (currentProject) {
                projects.push(currentProject);
            }
            currentProject = {
                title: line.replace('## ', ''),
                urls: [],
                description: '',
                tech: '',
                date: ''
            };
            collectingUrls = false;
        }
        else if (line.startsWith('**URLS:**') && currentProject) {
            collectingUrls = true;
            const urlsText = line.replace('**URLS:**', '').trim();
            if (urlsText) {
                const urlEntries = urlsText.split(',').map(entry => entry.trim());
                currentProject.urls = urlEntries.map(entry => {
                    const parts = entry.split('|');
                    return {
                        url: parts[0].trim(),
                        icon: parts[1] ? parts[1].trim() : 'link'
                    };
                }).filter(entry => entry.url);
                collectingUrls = false;
            }
        }
        else if (collectingUrls && currentProject && line && !line.startsWith('**')) {
            const urlEntry = line.replace(/,$/, '').trim();
            if (urlEntry) {
                const parts = urlEntry.split('|');
                if (parts[0].trim()) {
                    currentProject.urls.push({
                        url: parts[0].trim(),
                        icon: parts[1] ? parts[1].trim() : 'link'
                    });
                }
            }
        }
        else if (line.startsWith('**Description:**') && currentProject) {
            currentProject.description = line.replace('**Description:**', '').trim();
            collectingUrls = false;
        }
        else if (line.startsWith('**Tech:**') && currentProject) {
            const techText = line.replace('**Tech:**', '').trim();
            currentProject.tech = techText.split(',')[0].trim();
            collectingUrls = false;
        }
        else if (line.startsWith('**Date:**') && currentProject) {
            currentProject.date = line.replace('**Date:**', '').trim();
            collectingUrls = false;
        }
        else if (line.startsWith('**Views:**') && currentProject) {
            currentProject.views = line.replace('**Views:**', '').trim();
            collectingUrls = false;
        }
        else if (line.startsWith('**Downloads:**') && currentProject) {
            currentProject.downloads = line.replace('**Downloads:**', '').trim();
            collectingUrls = false;
        }
    }
    
    if (currentProject) {
        projects.push(currentProject);
    }
    return projects;
}

export async function load() {
    // Parse both markdown files
    const projects = parseProjectsFromMarkdown(projectsMarkdown);
    const publications = parseProjectsFromMarkdown(publicationsMarkdown);
    
    // Convert both to HTML (if you need)
    const projectsHtml = marked(projectsMarkdown);
    const publicationsHtml = marked(publicationsMarkdown);
    
    return {
        projects,
        publications,              // <-- now available in your page
        projectsHtml,
        publicationsHtml,
    };
}