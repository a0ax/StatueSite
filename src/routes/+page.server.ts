import { marked } from 'marked';
import projectsMarkdown from '$lib/projects.md?raw';

interface Project {
    title: string;
    urls: Array<{ url: string; icon: string }>;
    description: string;
    tech: string;
    date: string;
    views?: string;
    downloads?: string;
}

export async function load() {
    // Parse projects from the imported markdown string
    const projects = parseProjectsFromMarkdown(projectsMarkdown);
    
    // Parse markdown to HTML
    const htmlContent = marked(projectsMarkdown);
    
    return {
        projects,
        htmlContent
    };
}

function parseProjectsFromMarkdown(markdown: string): Project[] {
    const projects: Project[] = [];
    const lines = markdown.split('\n');
    let currentProject: Project | null = null;
    let collectingUrls = false;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Project title (## Project Name)
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
        // URLs line
        else if (line.startsWith('**URLS:**') && currentProject) {
            collectingUrls = true;
            // Check if URLs are on the same line
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
        // Collect URL lines (indented lines after **URLS:**)
        else if (collectingUrls && currentProject && line && !line.startsWith('**')) {
            // This is a URL line, parse it
            const urlEntry = line.replace(/,$/, '').trim(); // Remove trailing comma
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
        // Description line
        else if (line.startsWith('**Description:**') && currentProject) {
            currentProject.description = line.replace('**Description:**', '').trim();
            collectingUrls = false;
        }
        // Tech line
        else if (line.startsWith('**Tech:**') && currentProject) {
            const techText = line.replace('**Tech:**', '').trim();
            // Only take the first technology
            currentProject.tech = techText.split(',')[0].trim();
            collectingUrls = false;
        }
        // Date line
        else if (line.startsWith('**Date:**') && currentProject) {
            currentProject.date = line.replace('**Date:**', '').trim();
            collectingUrls = false;
        }
        // Views line
        else if (line.startsWith('**Views:**') && currentProject) {
            currentProject.views = line.replace('**Views:**', '').trim();
            collectingUrls = false;
        }
        // Downloads line
        else if (line.startsWith('**Downloads:**') && currentProject) {
            currentProject.downloads = line.replace('**Downloads:**', '').trim();
            collectingUrls = false;
        }
    }
    
    // Add the last project
    if (currentProject) {
        projects.push(currentProject);
    }
    return projects;
}
